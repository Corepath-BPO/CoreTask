import {
  AUTOMATION_ACTIONS,
  AUTOMATION_TRIGGERS,
  AutomationBranchType,
  CONDITION_OPERATOR_VALUES,
  GraphIssueLevel,
  operatorNeedsValue,
  operatorTakesMultipleValues,
  type ConditionOperator,
} from '@coretask/contracts';
import type {
  AutomationActionDefinition,
  AutomationBranchDefinition,
  AutomationConditionDefinition,
} from '@coretask/types';
import type { RuleIssue } from '@coretask/validation';

import { isUuid } from './automation-definition.mapper';

/**
 * What a definition points at, and whether it is describable at all.
 *
 * The half of validation `@coretask/validation` deliberately cannot do. That
 * package answers questions about a rule's shape and runs identically in the
 * browser; these are the questions that need to know what exists — whether the
 * section is still in this project, whether the person is still in this
 * workspace, whether the action is one the runner has code for.
 *
 * Everything here is pure. The service does the lookups; this decides what to
 * look up and what a missing answer means, so both can be read without a
 * database in front of you.
 */

/* -------------------------------------------------------------------------- */
/* Issues                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * An issue, plus whether it stops a draft being saved.
 *
 * The distinction is the whole editing model: **a draft may be incomplete, but
 * it may never be wrong.** An action with no section chosen yet is halfway
 * through being configured and has to save, or autosave would fight the person
 * using it. An action naming a section in somebody else's project is not
 * halfway through anything — it is a write that must not land, because once it
 * is stored the next reader has to decide whether to trust it.
 */
export interface DefinitionIssue extends RuleIssue {
  blocksDraft: boolean;
}

const error = (
  message: string,
  nodeId: string | null,
  path: string | null,
  blocksDraft: boolean,
): DefinitionIssue => ({ level: GraphIssueLevel.ERROR, nodeId, path, message, blocksDraft });

/* -------------------------------------------------------------------------- */
/* What an action may be configured with                                       */
/* -------------------------------------------------------------------------- */

/** What a configuration entry holds, and therefore how it is checked. */
export const ConfigKind = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  SECTION: 'SECTION',
  MEMBER: 'MEMBER',
  STATUS: 'STATUS',
  PRIORITY: 'PRIORITY',
  CUSTOM_FIELD: 'CUSTOM_FIELD',
  /** A value whose shape follows the field it is being written to. */
  ANY: 'ANY',
} as const;
export type ConfigKind = (typeof ConfigKind)[keyof typeof ConfigKind];

/** The kinds that name a row, and so can be checked against the database. */
export type ReferenceKind = Extract<
  ConfigKind,
  'SECTION' | 'MEMBER' | 'STATUS' | 'PRIORITY' | 'CUSTOM_FIELD'
>;

interface ConfigField {
  key: string;
  /**
   * Other keys that mean the same setting.
   *
   * Not indulgence: the builder, the runner and the old graph validator each
   * settled on a different name for the same thing — the inspector writes
   * `statusDefinitionId` where the runner reads `status`, and the graph
   * validator checks `customFieldId` where the runner reads `fieldId`. Until
   * those are reconciled, refusing either name would refuse rules that work.
   */
  aliases?: readonly string[];
  kind: ConfigKind;
  required: boolean;
}

/**
 * What each action needs, taken from what the runner actually reads.
 *
 * Derived from the runner rather than from the catalogue on purpose: the
 * catalogue says which actions may be *offered*, and this says which ones can
 * be *executed*. An action configured to the catalogue's satisfaction and
 * missing what the runner reads is a rule that publishes and then does nothing,
 * which is the failure nobody reports because it looks like the rule never
 * fired.
 */
const ACTION_CONFIG: Readonly<Record<string, readonly ConfigField[]>> = {
  ASSIGN_USER: [
    { key: 'userId', aliases: ['assigneeId'], kind: ConfigKind.MEMBER, required: true },
  ],
  UNASSIGN_USER: [],
  MOVE_TO_SECTION: [{ key: 'sectionId', kind: ConfigKind.SECTION, required: true }],
  UPDATE_STATUS: [
    { key: 'statusDefinitionId', aliases: ['status'], kind: ConfigKind.STATUS, required: true },
  ],
  UPDATE_PRIORITY: [
    {
      key: 'priorityDefinitionId',
      aliases: ['priority'],
      kind: ConfigKind.PRIORITY,
      required: true,
    },
  ],
  SET_DUE_DATE: [{ key: 'daysFromNow', kind: ConfigKind.NUMBER, required: false }],
  CLEAR_DUE_DATE: [],
  SET_CUSTOM_FIELD: [
    { key: 'fieldId', aliases: ['customFieldId'], kind: ConfigKind.CUSTOM_FIELD, required: true },
    { key: 'value', kind: ConfigKind.ANY, required: false },
  ],
  ADD_COMMENT: [{ key: 'body', kind: ConfigKind.TEXT, required: true }],
  SEND_IN_APP_NOTIFICATION: [
    /*
     * Optional because the runner falls back to the task's assignee. A rule
     * that notifies "whoever it is assigned to" is a real rule, and demanding
     * a name here would refuse it.
     */
    { key: 'userId', kind: ConfigKind.MEMBER, required: false },
    { key: 'title', kind: ConfigKind.TEXT, required: false },
    { key: 'body', kind: ConfigKind.TEXT, required: false },
  ],
  CREATE_SUBTASK: [{ key: 'title', kind: ConfigKind.TEXT, required: true }],
};

/**
 * What a condition's `fieldKey` compares, where that names a row.
 *
 * Only the fields whose value is an id. `title` and `dueDate` hold text and
 * dates, which no lookup can confirm and no lookup needs to.
 */
const CONDITION_FIELD_KIND: Readonly<Record<string, ReferenceKind>> = {
  sectionId: ConfigKind.SECTION,
  assigneeId: ConfigKind.MEMBER,
  createdById: ConfigKind.MEMBER,
  status: ConfigKind.STATUS,
  priority: ConfigKind.PRIORITY,
};

/** How the catalogue names a condition or action on a workspace field. */
const CUSTOM_FIELD_PREFIX = 'customField:';

/* -------------------------------------------------------------------------- */
/* References                                                                  */
/* -------------------------------------------------------------------------- */

export interface DefinitionReference {
  kind: ReferenceKind;
  id: string;
  /** The branch it belongs to, or null when it came from the trigger. */
  branchId: string | null;
  path: string;
}

/** A definition read only for the trigger and branches the checks walk. */
export interface CheckableDefinition {
  trigger: { type: string; configuration: Record<string, unknown> };
  branches: readonly AutomationBranchDefinition[];
}

/**
 * Everything the rule points at, ready to be looked up in one query per kind.
 *
 * Gathered before any lookup rather than checked as it is walked, so a rule
 * naming twenty sections costs one query rather than twenty. The path travels
 * with each reference so the failure can be reported against the field
 * somebody chose, not against the rule as a whole.
 */
export function collectReferences(definition: CheckableDefinition): DefinitionReference[] {
  const references: DefinitionReference[] = [];

  const add = (kind: ReferenceKind, value: unknown, branchId: string | null, path: string) => {
    for (const id of idsIn(value)) {
      /*
       * Only uuid-shaped values are looked up. The id columns are `@db.Uuid`,
       * and Postgres rejects a malformed uuid in an `IN` list outright — so a
       * status held as the legacy enum value `DONE` would turn a validation
       * message into a 500. Whether a non-uuid belongs here at all is decided
       * by `checkShapes`, which knows if the field had to be a reference.
       */
      if (isUuid(id)) references.push({ kind, id, branchId, path });
    }
  };

  /* The trigger's own scoping — the section a move has to land in. */
  add(ConfigKind.SECTION, definition.trigger.configuration['sectionId'], null, 'trigger.sectionId');
  add(
    ConfigKind.SECTION,
    definition.trigger.configuration['sectionIds'],
    null,
    'trigger.sectionIds',
  );

  for (const branch of definition.branches) {
    for (const condition of branch.conditionGroup?.conditions ?? []) {
      addConditionReferences(references, add, branch.id, condition);
    }

    for (const action of branch.actions) {
      addActionReferences(add, branch.id, action);
    }
  }

  return references;
}

type AddReference = (
  kind: ReferenceKind,
  value: unknown,
  branchId: string | null,
  path: string,
) => void;

function addConditionReferences(
  references: DefinitionReference[],
  add: AddReference,
  branchId: string,
  condition: AutomationConditionDefinition,
): void {
  const path = `conditions.${condition.id}`;

  if (condition.fieldKey.startsWith(CUSTOM_FIELD_PREFIX)) {
    /*
     * The field is checked; the value is not. What a valid value looks like
     * depends on the field's type — an option id for a select, a user id for a
     * people field — and reading the field's type to decide would make this a
     * database walk rather than a list of things to look up. The field
     * existing is the check that matters: a condition on a deleted field never
     * matches, whatever it was compared against.
     */
    add(
      ConfigKind.CUSTOM_FIELD,
      condition.fieldKey.slice(CUSTOM_FIELD_PREFIX.length),
      branchId,
      path,
    );
    return;
  }

  const kind = CONDITION_FIELD_KIND[condition.fieldKey];
  if (kind) add(kind, condition.value, branchId, `${path}.value`);
}

function addActionReferences(
  add: AddReference,
  branchId: string,
  action: AutomationActionDefinition,
): void {
  for (const field of ACTION_CONFIG[action.actionType] ?? []) {
    if (!isReferenceKind(field.kind)) continue;

    const value = valueOf(action.configuration, field);
    if (value !== undefined) add(field.kind, value, branchId, `actions.${action.id}.${field.key}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Storable shape                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The invariants that have to hold before any of this can be written down.
 *
 * Not a second rule validator — `validateRuleDefinition` remains the only
 * account of what a valid rule is, and `publish` runs it in full. This names
 * the subset of its refusals that apply to a draft as well, which is the subset
 * where the rows themselves would be wrong rather than merely unfinished:
 * two `PRIMARY` branches, an `OTHERWISE` that is not last, positions with a gap
 * in them. Each is a claim about the rule that no later edit can make true, and
 * two of them cannot even reach the database — `@@unique([ruleVersionId,
 * position])` would reject the write and turn a bad request into a 500.
 *
 * Everything `validateRuleDefinition` refuses and this does not is a question
 * of completeness: no condition chosen, no action added. Those save happily and
 * block publishing, because a builder that would not let you stop halfway is a
 * builder nobody can use.
 */
export function checkWritable(branches: readonly AutomationBranchDefinition[]): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const refuse = (message: string, branchId: string | null = null, path: string | null = null) =>
    issues.push(error(message, branchId, path, true));

  /* Order is asked of `position`, never of the array — the same reading the
   * shared validator takes, so a client that serialises its branches in some
   * other order is not failed for a fault that does not exist. */
  const ordered = [...branches].sort((a, b) => a.position - b.position);

  const primaries = ordered.filter((branch) => branch.type === AutomationBranchType.PRIMARY);
  const otherwises = ordered.filter((branch) => branch.type === AutomationBranchType.OTHERWISE);

  if (primaries.length !== 1) {
    refuse('A rule has exactly one “Check if” branch.', primaries[1]?.id ?? null, 'branches');
  } else if (primaries[0]?.position !== 0) {
    refuse('The “Check if” branch has to come first.', primaries[0]?.id ?? null);
  }

  if (otherwises.length > 1) {
    refuse('A rule can only have one “Otherwise” branch.', otherwises[1]?.id ?? null);
  }

  if (
    otherwises.length === 1 &&
    ordered[ordered.length - 1]?.type !== AutomationBranchType.OTHERWISE
  ) {
    refuse('The “Otherwise” branch has to come last.', otherwises[0]?.id ?? null);
  }

  for (const branch of otherwises) {
    if (branch.conditionGroup !== null) {
      /*
       * A condition on `OTHERWISE` would make it a second `OTHERWISE_IF` under
       * the wrong name, and the runner — which reaches it by exhausting the
       * list — would never test that condition at all.
       */
      refuse(
        '“Otherwise” runs when nothing else matched, so it cannot have its own conditions.',
        branch.id,
        'conditionGroup',
      );
    }
  }

  if (!contiguous(ordered.map((branch) => branch.position))) {
    refuse('These branches are not in a valid order.', null, 'branches');
  }

  for (const branch of ordered) {
    if (
      branch.conditionGroup &&
      !contiguous(branch.conditionGroup.conditions.map((condition) => condition.position))
    ) {
      refuse(
        'The conditions in this branch are not in a valid order.',
        branch.id,
        'conditionGroup.conditions',
      );
    }

    if (!contiguous(branch.actions.map((action) => action.position))) {
      refuse('The actions in this branch are not in a valid order.', branch.id, 'actions');
    }
  }

  return issues;
}

/**
 * Whether a list's positions are exactly 0…n-1.
 *
 * Catches a duplicate and a gap with one test, because both come from the same
 * failure — a reorder that wrote some rows and not others. A duplicate breaks
 * the unique index outright; a gap does not, and would leave the rule quietly
 * running its steps in an order nobody chose.
 */
function contiguous(positions: readonly number[]): boolean {
  return [...positions].sort((a, b) => a - b).every((value, index) => value === index);
}

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Whether every step is one the engine has code for, and configured with the
 * kind of thing it reads.
 *
 * Split by `blocksDraft` rather than by severity, because both halves are
 * errors — one is an error about a rule that is not finished, and the other is
 * an error about a rule that is not describable.
 */
export function checkShapes(definition: CheckableDefinition): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];

  /*
   * An unknown trigger does not block the draft. A rule stored before a trigger
   * was renamed has to load, report itself as unrunnable and be fixable — and
   * it can only be fixed by being saved.
   */
  if (!AUTOMATION_TRIGGERS.includes(definition.trigger.type as never)) {
    issues.push(error('This is not a trigger the engine understands.', null, 'trigger', false));
  }

  for (const branch of definition.branches) {
    for (const condition of branch.conditionGroup?.conditions ?? []) {
      issues.push(...checkCondition(branch, condition));
    }

    for (const action of branch.actions) {
      issues.push(...checkAction(branch, action));
    }
  }

  return issues;
}

function checkCondition(
  branch: AutomationBranchDefinition,
  condition: AutomationConditionDefinition,
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const path = `conditions.${condition.id}`;
  const operator = condition.operator as ConditionOperator;

  if (!CONDITION_OPERATOR_VALUES.includes(operator)) {
    /*
     * Does not block the draft, for the same reason an unknown trigger does
     * not: a rule converted from the node tree can carry a comparison the new
     * vocabulary has no word for, and it has to be openable to be corrected.
     */
    issues.push(
      error(
        'This is not a comparison the engine understands.',
        branch.id,
        `${path}.operator`,
        false,
      ),
    );

    return issues;
  }

  const hasValue =
    condition.value !== null && condition.value !== undefined && condition.value !== '';

  if (operatorNeedsValue(operator) && !hasValue) {
    issues.push(
      error('Choose what this condition compares against.', branch.id, `${path}.value`, false),
    );
  }

  if (!operatorNeedsValue(operator) && hasValue) {
    /*
     * "Is empty" with a value beside it is a rule whose author believes the
     * value is being used. Refused rather than ignored, since the runner will
     * ignore it and nobody will be told.
     */
    issues.push(
      error('This comparison takes no value of its own.', branch.id, `${path}.value`, true),
    );
  }

  if (operatorTakesMultipleValues(operator) && hasValue && !Array.isArray(condition.value)) {
    issues.push(error('This comparison takes a list of values.', branch.id, `${path}.value`, true));
  }

  return issues;
}

function checkAction(
  branch: AutomationBranchDefinition,
  action: AutomationActionDefinition,
): DefinitionIssue[] {
  const issues: DefinitionIssue[] = [];
  const base = `actions.${action.id}`;

  /*
   * An action the runner has no code for blocks the draft. Unlike a renamed
   * trigger there is no history to preserve: every action the builder can
   * offer comes from `AUTOMATION_ACTIONS`, so anything else was never
   * offerable and can only have been made up by a client.
   */
  if (!AUTOMATION_ACTIONS.includes(action.actionType as never)) {
    issues.push(
      error(
        `“${action.actionType}” is not an action the engine can run.`,
        branch.id,
        `${base}.actionType`,
        true,
      ),
    );

    return issues;
  }

  for (const field of ACTION_CONFIG[action.actionType] ?? []) {
    const value = valueOf(action.configuration, field);
    const path = `${base}.${field.key}`;

    if (value === undefined || value === null || value === '') {
      if (field.required) {
        issues.push(error('This action still needs to be set up.', branch.id, path, false));
      }

      continue;
    }

    issues.push(...checkKind(field, value, branch.id, path));
  }

  return issues;
}

/**
 * Whether one configuration entry holds the kind of thing it names.
 *
 * These block the draft. A section id that is not an id, or a comment body that
 * is an object, is not an edit in progress — no form produces either — so
 * storing it would only move the failure to whoever reads it next.
 */
function checkKind(
  field: ConfigField,
  value: unknown,
  branchId: string,
  path: string,
): DefinitionIssue[] {
  switch (field.kind) {
    case ConfigKind.ANY:
      return [];

    case ConfigKind.TEXT:
      return typeof value === 'string'
        ? []
        : [error('This setting has to be text.', branchId, path, true)];

    case ConfigKind.NUMBER:
      return typeof value === 'number' && Number.isFinite(value)
        ? []
        : [error('This setting has to be a number.', branchId, path, true)];

    case ConfigKind.SECTION:
    case ConfigKind.MEMBER:
    case ConfigKind.CUSTOM_FIELD:
      return isUuid(value)
        ? []
        : [error('This setting has to name a real one.', branchId, path, true)];

    /*
     * Status and priority are the two settings that can arrive either way: the
     * inspector writes the definition's id, and rules written before the
     * status tables existed hold the enum value. A uuid is looked up; anything
     * else only has to be a non-empty string, which is all the runner needs to
     * compare it.
     */
    case ConfigKind.STATUS:
    case ConfigKind.PRIORITY:
      return typeof value === 'string' && value !== ''
        ? []
        : [error('This setting has to name a real one.', branchId, path, true)];

    default:
      return [];
  }
}

/* -------------------------------------------------------------------------- */

function valueOf(configuration: Record<string, unknown>, field: ConfigField): unknown {
  const direct = configuration[field.key];
  if (direct !== undefined) return direct;

  for (const alias of field.aliases ?? []) {
    const value = configuration[alias];
    if (value !== undefined) return value;
  }

  return undefined;
}

/** A value, or the values inside it, as the strings a lookup can take. */
function idsIn(value: unknown): string[] {
  if (typeof value === 'string') return value === '' ? [] : [value];
  if (Array.isArray(value))
    return value.filter((it): it is string => typeof it === 'string' && it !== '');

  return [];
}

function isReferenceKind(kind: ConfigKind): kind is ReferenceKind {
  return (
    kind === ConfigKind.SECTION ||
    kind === ConfigKind.MEMBER ||
    kind === ConfigKind.STATUS ||
    kind === ConfigKind.PRIORITY ||
    kind === ConfigKind.CUSTOM_FIELD
  );
}
