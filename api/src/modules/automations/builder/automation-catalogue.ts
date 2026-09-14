import {
  ACTION_LABEL,
  AUTOMATION_ACTIONS,
  AutomationAction,
  AutomationTrigger,
  CONDITION_OPERATOR,
  CONDITION_VALUE_TYPE,
  ConditionValueKind,
  MAX_ACTIONS_PER_EXECUTION,
  MAX_AUTOMATION_DEPTH,
  TRIGGER_CONFIG_FORM,
  TRIGGER_CONFIG_FORM_LABEL,
  TRIGGER_CONFIG_FORMS_BY_TRIGGER,
  TRIGGER_GROUP,
  defaultOperatorForConditionField,
  isComputedFieldType,
  isEvaluableOperator,
  operatorNeedsValue,
  operatorTakesMultipleValues,
  type ConditionOperator,
  type ConditionValueType,
  type CustomFieldType,
  type TriggerConfigForm,
  type WorkspaceRole,
} from '@coretask/contracts';
import type { AutomationCatalogEntry } from '@coretask/types';

/**
 * What the builder's pickers may offer, and which of it the engine really runs.
 *
 * Every `available` in this file is derived from something checkable — the
 * executable action list, the fields the runner can read, the forms its trigger
 * matcher can honour. None of it is asserted. That is the whole point: a row
 * shown as working must be one that works, because an action which appears to
 * run and silently does nothing is worse than one visibly greyed out.
 *
 * The other half of the convention is that nothing is hidden. An entry missing
 * from the catalogue reads as *never considered* and sends somebody looking for
 * it elsewhere; the same entry greyed with a reason reads as *not yet*, which is
 * the truth. So `reason` is not decoration — an unavailable row without one is a
 * refusal with no explanation, and this module makes that shape unconstructible.
 */

/* -------------------------------------------------------------------------- */
/* Response shapes                                                             */
/* -------------------------------------------------------------------------- */

/** One way a trigger's event can be narrowed, chosen after the trigger itself. */
export interface TriggerConfigFormOption {
  form: TriggerConfigForm;
  label: string;
  /** Whether the form asks for a section at all. */
  needsValue: boolean;
  /** Whether that field takes several sections rather than one. */
  multiple: boolean;
  available: boolean;
  reason: string | null;
}

/** A trigger, with the shapes its configuration may take. */
export interface AutomationTriggerEntry extends AutomationCatalogEntry {
  configForms: TriggerConfigFormOption[];
}

/** A condition, with what its value is — which is what decides its operators. */
export interface AutomationConditionEntry extends AutomationCatalogEntry {
  /** Feeds `OPERATORS_BY_VALUE_TYPE` on the client. */
  valueType: ConditionValueType;
}

/**
 * What the engine can do at all, independent of any one project.
 *
 * Separate from `permissions`: this says what is possible, that says what this
 * caller may do. A client that conflates them tells a manager a feature is
 * forbidden when it simply does not exist yet.
 */
export interface AutomationCapabilities {
  /** The runner walks a branch's arms and takes one. */
  branching: boolean;
  /** Nothing waits: a DELAY node is refused at validation. */
  delays: boolean;
  externalActions: boolean;
  ai: boolean;
  conditionsOnCustomFields: boolean;
  actionsOnCustomFields: boolean;
  maxActionsPerExecution: number;
  maxRuleDepth: number;
}

/** What this caller may do with the project's rules. */
export interface AutomationPermissions {
  role: WorkspaceRole;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canDelete: boolean;
}

/** A project's custom field, as the generated entries need it. */
export interface CatalogueCustomField {
  id: string;
  name: string;
  type: string;
}

/**
 * The fields a rule can watch, compare or write.
 *
 * A computed field is none of those: its value is never on the row the
 * engine loads, and writing it would be overwritten by the next read. It is
 * left out of every generated row rather than shown greyed, because there is
 * no configuration under which it becomes available.
 */
function settable(fields: readonly CatalogueCustomField[]): CatalogueCustomField[] {
  return fields.filter((field) => !isComputedFieldType(field.type as CustomFieldType));
}

/* -------------------------------------------------------------------------- */
/* What the engine can actually do                                             */
/* -------------------------------------------------------------------------- */

/**
 * The field keys `AutomationRunnerService.readField` resolves against the task.
 *
 * Listed rather than imported because the runner's answer is a `switch` — code,
 * not data — so there is nothing to read at run time. `automation-catalogue.spec`
 * calls `readField` for each of these and asserts it returns the task's own
 * value, so the two cannot drift apart silently.
 *
 * Anything absent falls through to `event.after?.[field]`, which for most events
 * carries nothing under that key: the comparison then reads `undefined`, fails,
 * and the rule is published, never fires, and reports nothing anywhere. That is
 * the failure this set exists to prevent offering.
 */
export const READABLE_TASK_FIELDS: readonly string[] = [
  'status',
  'priority',
  'sectionId',
  'assigneeId',
  'createdById',
  'title',
  /*
   * `description` was added to `readField` and to the metadata's condition
   * fields without being added here, which greyed a working check out with the
   * generic "the engine cannot read this" — the mirror of offering one that
   * does not work, and just as untrue. The spec below calls `readField` for
   * every name in this list, so the two can only agree.
   */
  'description',
  'completed',
  'dueDate',
  'startDate',
  // The rest of what the list view shows as a column, so a rule can ask what
  // a person can see: the estimate, and the two dates the task itself keeps.
  'estimatedMinutes',
  'createdAt',
  'completedAt',
];

const READABLE = new Set(READABLE_TASK_FIELDS);

/**
 * What kind of value each condition field holds.
 *
 * One definition, read both by the metadata service that offers these fields
 * and by the validator that judges what somebody built with them. It used to be
 * two — a list of rows there, a private map here — and they drifted exactly as
 * you would expect: `description` and `createdById` were offered by the builder
 * and read by the runner while the validator, never taught them, answered
 * "unknown" for both. Nothing showed while only the builder asked; the moment
 * publish asks the same question, that answer refuses a working rule.
 *
 * So a field is added here once, or it is not added.
 */
export const CONDITION_FIELD_KINDS = {
  status: ConditionValueKind.ENUM,
  priority: ConditionValueKind.ENUM,
  sectionId: ConditionValueKind.REFERENCE,
  assigneeId: ConditionValueKind.REFERENCE,
  createdById: ConditionValueKind.REFERENCE,
  title: ConditionValueKind.TEXT,
  description: ConditionValueKind.TEXT,
  // Offered as "task or all subtasks completion status is…" and read by the
  // runner, but missing here — so the validator refused every rule that used
  // it as a field "no longer available", and the row could never be published.
  completed: ConditionValueKind.BOOLEAN,
  dueDate: ConditionValueKind.DATE,
  startDate: ConditionValueKind.DATE,
  estimatedMinutes: ConditionValueKind.NUMBER,
  createdAt: ConditionValueKind.DATE,
  completedAt: ConditionValueKind.DATE,
} as const satisfies Record<string, ConditionValueKind>;

/** The kind for a field key off the wire, which may be anything at all. */
export function conditionFieldKind(field: unknown): ConditionValueKind | undefined {
  if (typeof field !== 'string') return undefined;

  return (CONDITION_FIELD_KINDS as Record<string, ConditionValueKind | undefined>)[field];
}

/**
 * Whether the runner can evaluate a condition about this field key.
 *
 * One rule for the hand-written entries and the generated custom-field ones
 * alike. A `customField:<id>` key resolves because the runner loads the task's
 * value rows with the task and `readField` reads the populated column back —
 * see `customFieldActual` beside it.
 */
export function runnerCanReadField(fieldKey: string): boolean {
  return fieldKey.startsWith('customField:') || READABLE.has(fieldKey);
}

/** The field id inside a condition's `customField:<id>` key, or null. */
export function customFieldConditionId(field: unknown): string | null {
  if (typeof field !== 'string' || !field.startsWith('customField:')) return null;

  return field.slice('customField:'.length);
}

/**
 * The value kind a custom field's type means, for the validator.
 *
 * `conditionFieldKind` answers for the hand-written keys; a generated key names
 * a field whose kind is a fact about that field's type, which only the caller
 * holding the row can supply. Undefined for an unknown type, which the shared
 * check reads as "no longer available" — the honest answer for both.
 */
export function kindForCustomFieldType(type: string | undefined): ConditionValueKind | undefined {
  switch (type) {
    case 'TEXT':
    case 'URL':
    case 'EMAIL':
      return ConditionValueKind.TEXT;
    case 'NUMBER':
    case 'RATING':
      return ConditionValueKind.NUMBER;
    case 'DATE':
      return ConditionValueKind.DATE;
    // A formula is worked out on read; a rule can neither compare a value it
    // cannot load off the row nor set one. It has no kind, so no row.
    case 'FORMULA':
      return undefined;
    case 'CHECKBOX':
      return ConditionValueKind.BOOLEAN;
    case 'SINGLE_SELECT':
    case 'MULTI_SELECT':
    case 'PEOPLE':
      return ConditionValueKind.REFERENCE;
    default:
      return undefined;
  }
}

/**
 * Whether the comparison this row arrives with is one the engine performs.
 *
 * Reading the field is only half of a condition. The other half is the
 * comparison, and the builder writes a particular one — the first the field
 * offers — the moment somebody picks the row out of the catalogue. If that
 * operator has no entry in `FILTER_OPERATOR_BY_CONDITION_OPERATOR` the runner's
 * switch falls to its default and the condition is false on every event: the
 * rule saves, publishes, goes ACTIVE and never fires. That is the failure
 * f428e58 fixed for the operators the panel could reach, and this is the same
 * check applied one step earlier, where the row is offered in the first place.
 *
 * It bit exactly once: a checkbox offers "is checked" and "is not checked",
 * and for a while the engine could evaluate neither, so "Task or all subtasks
 * completion status is…" and every checkbox custom field were greyed here. The
 * runner now makes those comparisons itself (`DIRECT_CONDITION_OPERATORS`), so
 * the gate lets them through — and stays, for the next operator somebody adds
 * to a type's list before teaching the engine to run it.
 */
function runnerCanCompare(fieldKey: string, valueType: ConditionValueType): boolean {
  return isEvaluableOperator(defaultOperatorForConditionField(fieldKey, valueType));
}

/** Whether `AutomationRunnerService.runAction` has a case for this subtype. */
export function runnerCanPerform(subtype: string): boolean {
  return (AUTOMATION_ACTIONS as readonly string[]).includes(subtype);
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The condition catalogue's groups, in the order it shows them.
 *
 * Declared here rather than reusing `AUTOMATION_SELECTOR_CATEGORY`: those are
 * the builder's older engineering groupings ("Work item", "Fields") and these
 * are the phrases somebody reads down the left of the picker. Same list under
 * two different jobs is how one of them ends up wrong.
 */
export const CONDITION_CATEGORY = {
  /*
   * First, because the catalogue is iterated in the order this is declared.
   *
   * "Create your own" is the widest offer in the list and belongs at the top
   * where somebody arriving with a question no row answers will see it, rather
   * than after six groups they have already read past. That it is the one entry
   * nobody can pick yet is the reason to keep it visible, not to bury it.
   */
  CREATE_YOUR_OWN: 'Create your own',
  TASK_MOVED: 'Task moved',
  TASK_FIELD: 'Task field is',
  STATUS: 'Status is',
  TASK_DETAILS: 'Task details',
  CUSTOM_FIELD: 'Custom field is…',
  TASK_HAS: 'Task has',
} as const;

/** The action catalogue's groups, in the order it shows them. */
export const ACTION_CATEGORY = {
  MOVE_TASK: 'Move task',
  CHANGE_STATUS: 'Change status',
  CHANGE_FIELD: 'Change task field to…',
  CHANGE_CUSTOM_FIELD: 'Change custom field to…',
  CREATE_NEW: 'Create new',
  CONVERT: 'Convert task to…',
  ADD_TO_TASK: 'Add to task',
} as const;

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

/** Shared by a trigger and a condition greyed for the same missing feature. */
const NO_APPROVALS_REASON = 'CoreTask has no approvals.';

/**
 * Triggers nothing publishes, and why.
 *
 * Everything else in `AUTOMATION_TRIGGERS` reaches the queue from
 * `TasksService`, `ProjectWorkItemService` or `CustomFieldsService` — checked
 * against the `automation.publish` call sites rather than assumed. A trigger
 * with no publisher is the quietest failure the builder can sell: the rule
 * saves, publishes, validates, and then waits forever for an event that is
 * never sent.
 */
const TRIGGER_UNAVAILABLE_REASON: Partial<Record<AutomationTrigger, string>> = {
  [AutomationTrigger.COMMENT_ADDED]:
    'Adding a comment does not raise an automation event yet, so a rule waiting for one would never run.',
  [AutomationTrigger.TICKET_CREATED]:
    'Ticket events are delivered, but automation actions currently operate on tasks, not tickets.',
  [AutomationTrigger.TICKET_STATUS_CHANGED]:
    'Ticket events are delivered, but automation actions currently operate on tasks, not tickets.',
};

/** Why the runner cannot execute a trigger, or null when it can. */
export function triggerUnavailableReason(trigger: string): string | null {
  return TRIGGER_UNAVAILABLE_REASON[trigger as AutomationTrigger] ?? null;
}

/**
 * The comparison each configuration form makes.
 *
 * "Section is one of…" *is* `IS_ONE_OF`, so asking the operator tables whether
 * it needs a value and whether that value is a list gives the same answer the
 * condition inspector already gives. The alternative — a second hand-written
 * list of which of the four forms takes a section — is a list that would have to
 * be kept in step with nothing enforcing it.
 */
const FORM_OPERATOR: Record<TriggerConfigForm, ConditionOperator | null> = {
  SECTION_CHANGED: null,
  SECTION_CHANGED_TO: CONDITION_OPERATOR.IS,
  SECTION_CHANGED_TO_NOT: CONDITION_OPERATOR.IS_NOT,
  SECTION_CHANGED_TO_ANY_OF: CONDITION_OPERATOR.IS_ONE_OF,
};

/**
 * The forms `AutomationRunnerService.triggerMatches` can honour.
 *
 * It reads a single `sectionId` from the trigger's configuration and compares it
 * for equality — which covers "any move" (nothing configured, so every event
 * matches) and "moved into this one". The negated and any-of forms need a
 * configuration shape it does not read, and the danger is specific rather than
 * theoretical: a rule saved as "section is not Done" would still be matched by
 * the equality branch and fire on exactly the events it was written to exclude.
 * Offering it disabled is the difference between a missing feature and a rule
 * that does the opposite of what it says.
 */
const RUNNABLE_TRIGGER_FORMS: readonly TriggerConfigForm[] = [
  TRIGGER_CONFIG_FORM.SECTION_CHANGED,
  TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO,
];

const TRIGGER_FORM_REASON =
  'The engine matches one section for equality; it cannot yet negate that test or match a list.';

/**
 * The order the trigger picker reads its groups in — Asana's order, with the
 * two rows that belong to no group first.
 *
 * Needed because a client grouping in array order, which is what the condition
 * and action catalogues expect it to do, would otherwise draw a heading twice
 * the moment two entries of one group were separated by another's.
 */
const TRIGGER_CATEGORY_ORDER: readonly string[] = [
  TRIGGER_GROUP.UNGROUPED,
  TRIGGER_GROUP.MOVED,
  TRIGGER_GROUP.FIELD_CHANGED,
  TRIGGER_GROUP.DUE_DATE,
  TRIGGER_GROUP.START_DATE,
  TRIGGER_GROUP.STATUS_CHANGED,
  TRIGGER_GROUP.CUSTOM_FIELD_CHANGED,
  TRIGGER_GROUP.ADDED_TO_TASK,
];

/**
 * The picker's wording for the real triggers.
 *
 * A full record, not `TRIGGER_LABEL`: that one is a sentence — "When a task is
 * moved to a section" — and the rule list and node summaries keep reading it.
 * These are the rows read down a picker, worded the way Asana words them, and a
 * new enum member fails to compile here until it says what its row reads.
 */
const TRIGGER_PICKER_LABEL: Record<AutomationTrigger, string> = {
  TASK_CREATED: 'Task is added to this project',
  TASK_UPDATED: 'Task is updated',
  TASK_MOVED_TO_SECTION: 'Task is moved to a section',
  TASK_STATUS_CHANGED: 'Status is changed',
  TASK_PRIORITY_CHANGED: 'Priority is changed',
  TASK_ASSIGNED: 'Task is assigned',
  TASK_COMPLETED: 'Task or all subtasks completion status is changed',
  TASK_DUE_DATE_CHANGED: 'Due date is changed',
  TASK_START_DATE_CHANGED: 'Start date is changed',
  TASK_ESTIMATE_CHANGED: 'Estimate is changed',
  TASK_TITLE_CHANGED: 'Task name is changed',
  TASK_DESCRIPTION_CHANGED: 'Task description is changed',
  COMMENT_ADDED: 'Comment is added',
  CUSTOM_FIELD_CHANGED: 'A custom field is changed',
  TICKET_CREATED: 'Ticket is reported',
  TICKET_STATUS_CHANGED: 'Ticket is changed…',
};

/**
 * Said only where the row's own line would over-promise.
 *
 * Two labels above are Asana's wording for something this engine does half of,
 * and the honest half belongs on the row rather than in a support ticket. The
 * rest stay empty: a description that restates its label is a stutter.
 */
const TRIGGER_PICKER_DESCRIPTION: Partial<Record<AutomationTrigger, string>> = {
  TASK_CREATED:
    'Fires when a task is created in this project. Moving one in from elsewhere raises no event yet.',
  TASK_COMPLETED:
    'Fires when the task itself is completed, or when the last of its open subtasks is.',
};

/**
 * Triggers the engine has no event for at all, offered greyed.
 *
 * Same convention as the unimplemented rows in `ACTION_SPECS`: a plain-string
 * subtype outside the enum — a disabled row is never selectable, and the
 * validator would refuse the subtype anyway — and a reason on every one,
 * because a greyed row without one is a refusal with no explanation.
 */
interface PlannedTriggerSpec {
  subtype: string;
  label: string;
  category: string;
  reason: string;
}

const NOTHING_WATCHES_THE_CLOCK =
  'Every trigger fires from an event on a task; nothing watches the clock, so a date drawing near or passing raises no event.';

const PLANNED_TRIGGER_SPECS: readonly PlannedTriggerSpec[] = [
  {
    subtype: 'RUN_MANUALLY',
    label: 'Rule is run manually',
    category: TRIGGER_GROUP.UNGROUPED,
    reason:
      'There is no way to fire a rule by hand yet; every rule waits for an event from its project.',
  },
  {
    subtype: 'SCHEDULED_TIME',
    label: 'Scheduled time occurs…',
    category: TRIGGER_GROUP.UNGROUPED,
    reason: NOTHING_WATCHES_THE_CLOCK,
  },
  {
    subtype: 'TASK_TYPE_CHANGED',
    label: 'Task type is changed',
    category: TRIGGER_GROUP.FIELD_CHANGED,
    reason: 'A task and a ticket are separate records here, so a task carries no type to change.',
  },
  {
    subtype: 'DUE_DATE_APPROACHING',
    label: 'Due date is approaching',
    category: TRIGGER_GROUP.DUE_DATE,
    reason: NOTHING_WATCHES_THE_CLOCK,
  },
  {
    subtype: 'TASK_OVERDUE',
    label: 'Task is overdue',
    category: TRIGGER_GROUP.DUE_DATE,
    reason: NOTHING_WATCHES_THE_CLOCK,
  },
  {
    subtype: 'START_DATE_APPROACHING',
    label: 'Start date is approaching',
    category: TRIGGER_GROUP.START_DATE,
    reason: NOTHING_WATCHES_THE_CLOCK,
  },
  {
    subtype: 'START_DATE_PASSED',
    label: 'Start date has passed',
    category: TRIGGER_GROUP.START_DATE,
    reason: NOTHING_WATCHES_THE_CLOCK,
  },
  {
    subtype: 'APPROVAL_STATUS_CHANGED',
    label: 'Approval status is changed',
    category: TRIGGER_GROUP.STATUS_CHANGED,
    reason: NO_APPROVALS_REASON,
  },
  {
    subtype: 'TASK_NO_LONGER_BLOCKED',
    label: 'Task is no longer blocked',
    category: TRIGGER_GROUP.STATUS_CHANGED,
    reason:
      'Nothing blocks one task on another here — only a BLOCKED status — so there is no event for a task coming unblocked.',
  },
  {
    subtype: 'ATTACHMENT_ADDED',
    label: 'Attachment is added',
    category: TRIGGER_GROUP.ADDED_TO_TASK,
    reason: 'Adding an attachment does not raise an automation event yet.',
  },
  {
    subtype: 'COLLABORATOR_ADDED',
    label: 'Collaborator is added',
    category: TRIGGER_GROUP.ADDED_TO_TASK,
    reason:
      'A task has one assignee here rather than a collaborator list, so there is nobody to add that could fire this.',
  },
];

/** The key a generated per-field *date* trigger row carries. Never a valid node
    subtype — these rows are all disabled — but unique, so the client can key
    and icon them; its icon map splits on the first colon. */
export function customFieldTriggerKey(fieldId: string, kind: 'APPROACHING' | 'OVERDUE'): string {
  return `customFieldTrigger:${fieldId}:${kind}`;
}

/**
 * Asana's per-field trigger rows, generated from the project's own fields.
 *
 * "[Field] is changed" is real: it is `CUSTOM_FIELD_CHANGED` with the field
 * pre-filled — the same shape the generated `SET_CUSTOM_FIELD` action rows use —
 * and the runner narrows on that `fieldId`. The date variants stay greyed:
 * they would need something watching the clock, and nothing does.
 */
function customFieldTriggerRows(fields: readonly CatalogueCustomField[]): AutomationTriggerEntry[] {
  return settable(fields).flatMap((field) => {
    const dateRow = (kind: 'APPROACHING' | 'OVERDUE', label: string): AutomationTriggerEntry => ({
      subtype: customFieldTriggerKey(field.id, kind),
      label,
      description: '',
      category: TRIGGER_GROUP.CUSTOM_FIELD_CHANGED,
      available: false,
      reason: NOTHING_WATCHES_THE_CLOCK,
      configForms: [],
      fieldId: field.id,
      fieldName: field.name,
    });

    return [
      {
        subtype: AutomationTrigger.CUSTOM_FIELD_CHANGED,
        label: `${field.name} is changed`,
        description: '',
        category: TRIGGER_GROUP.CUSTOM_FIELD_CHANGED,
        available: true,
        reason: null,
        configForms: [],
        fieldId: field.id,
        fieldName: field.name,
      },
      // Only a date can approach or pass.
      ...(field.type === 'DATE'
        ? [
            dateRow('APPROACHING', `${field.name} is approaching`),
            dateRow('OVERDUE', `${field.name} is overdue`),
          ]
        : []),
    ];
  });
}

/**
 * Every declared trigger plus the planned rows, grouped the way the picker
 * shows them, with the shapes each configuration may take.
 *
 * Only `TASK_MOVED_TO_SECTION` offers forms. The rest need no narrowing beyond
 * the event itself, and an empty array on each of them would be one more list to
 * hold in step with the trigger enum for nothing.
 */
/**
 * The real triggers in the order their rows read, within their groups.
 *
 * Enum order put "added to this project" above "moved to a section"; this is
 * the picker's reading order, and the catalogue spec asserts every enum member
 * appears exactly once so a new trigger cannot quietly fall out of this list.
 */
const REAL_TRIGGER_ORDER: readonly AutomationTrigger[] = [
  AutomationTrigger.TASK_MOVED_TO_SECTION,
  AutomationTrigger.TASK_CREATED,
  AutomationTrigger.TICKET_CREATED,
  AutomationTrigger.TASK_ASSIGNED,
  AutomationTrigger.TASK_UPDATED,
  AutomationTrigger.TASK_PRIORITY_CHANGED,
  AutomationTrigger.TASK_TITLE_CHANGED,
  AutomationTrigger.TASK_DESCRIPTION_CHANGED,
  AutomationTrigger.TASK_ESTIMATE_CHANGED,
  AutomationTrigger.TASK_DUE_DATE_CHANGED,
  AutomationTrigger.TASK_START_DATE_CHANGED,
  AutomationTrigger.TASK_STATUS_CHANGED,
  AutomationTrigger.TICKET_STATUS_CHANGED,
  AutomationTrigger.TASK_COMPLETED,
  AutomationTrigger.CUSTOM_FIELD_CHANGED,
  AutomationTrigger.COMMENT_ADDED,
];

export function triggerCatalogue(
  fields: readonly CatalogueCustomField[],
): AutomationTriggerEntry[] {
  const real = REAL_TRIGGER_ORDER.map((subtype) => {
    const reason = triggerUnavailableReason(subtype);

    return {
      subtype,
      label: TRIGGER_PICKER_LABEL[subtype],
      description: TRIGGER_PICKER_DESCRIPTION[subtype] ?? '',
      category: triggerCategory(subtype),
      available: reason === null,
      reason,
      configForms: configFormsFor(subtype),
    };
  });

  const planned = PLANNED_TRIGGER_SPECS.map((spec) => ({
    subtype: spec.subtype,
    label: spec.label,
    description: '',
    category: spec.category,
    available: false,
    reason: spec.reason,
    configForms: [],
  }));

  /*
   * Real rows before planned ones inside each group, generated field rows
   * after the generic one they defer to — and the whole list gathered by
   * category so no heading is ever drawn twice.
   */
  const entries = [...real, ...planned, ...customFieldTriggerRows(fields)];

  return TRIGGER_CATEGORY_ORDER.flatMap((category) =>
    entries.filter((entry) => entry.category === category),
  );
}

function configFormsFor(trigger: AutomationTrigger): TriggerConfigFormOption[] {
  const forms = TRIGGER_CONFIG_FORMS_BY_TRIGGER[trigger] ?? [];

  return forms.map((form) => {
    const operator = FORM_OPERATOR[form];
    const available = RUNNABLE_TRIGGER_FORMS.includes(form);

    return {
      form,
      label: TRIGGER_CONFIG_FORM_LABEL[form],
      // "Section is changed" carries its whole question in the form itself,
      // exactly as a valueless operator does, so there is no section to pick.
      needsValue: operator !== null && operatorNeedsValue(operator),
      multiple: operator !== null && operatorTakesMultipleValues(operator),
      available,
      reason: available ? null : TRIGGER_FORM_REASON,
    };
  });
}

/**
 * Which group a trigger sits under.
 *
 * A full record rather than a partial with a fallback: a new enum member filed
 * under a default group is exactly the kind of quiet misplacement nobody
 * notices until a user cannot find the row.
 */
function triggerCategory(trigger: AutomationTrigger): string {
  const byTrigger: Record<AutomationTrigger, string> = {
    TASK_CREATED: TRIGGER_GROUP.MOVED,
    TASK_MOVED_TO_SECTION: TRIGGER_GROUP.MOVED,
    // A ticket being reported is a work item arriving, which is the nearest
    // thing this group means; the row is greyed either way.
    TICKET_CREATED: TRIGGER_GROUP.MOVED,
    TASK_ASSIGNED: TRIGGER_GROUP.FIELD_CHANGED,
    TASK_UPDATED: TRIGGER_GROUP.FIELD_CHANGED,
    TASK_PRIORITY_CHANGED: TRIGGER_GROUP.FIELD_CHANGED,
    TASK_TITLE_CHANGED: TRIGGER_GROUP.FIELD_CHANGED,
    TASK_DESCRIPTION_CHANGED: TRIGGER_GROUP.FIELD_CHANGED,
    TASK_ESTIMATE_CHANGED: TRIGGER_GROUP.FIELD_CHANGED,
    TASK_DUE_DATE_CHANGED: TRIGGER_GROUP.DUE_DATE,
    TASK_START_DATE_CHANGED: TRIGGER_GROUP.START_DATE,
    TASK_STATUS_CHANGED: TRIGGER_GROUP.STATUS_CHANGED,
    TASK_COMPLETED: TRIGGER_GROUP.STATUS_CHANGED,
    TICKET_STATUS_CHANGED: TRIGGER_GROUP.STATUS_CHANGED,
    CUSTOM_FIELD_CHANGED: TRIGGER_GROUP.CUSTOM_FIELD_CHANGED,
    COMMENT_ADDED: TRIGGER_GROUP.ADDED_TO_TASK,
  };

  return byTrigger[trigger];
}

/* -------------------------------------------------------------------------- */
/* Conditions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One catalogue row before its availability is worked out.
 *
 * `reason` is supplied only where the answer is something other than "can the
 * runner read this field" — a feature that does not exist at all, rather than a
 * field it cannot reach. Leaving it out is what puts the row under the
 * readable-field check.
 */
interface ConditionSpec {
  subtype: string;
  label: string;
  category: string;
  valueType: ConditionValueType;
  reason?: string;
  description?: string;
}

const FORMS_AND_EMAIL_REASON = 'Forms and inbound email are not built yet.';
const TASK_ALONE_REASON =
  'The engine loads the task an event is about and nothing beside it, so this cannot be checked.';

/** The generic answer, for a field the runner has no case for. */
const UNREADABLE_FIELD_REASON =
  'The engine cannot read this on a task, so the check would never match.';

/** The generic answer, for a field the runner has no *comparison* for. */
const UNCOMPARABLE_FIELD_REASON =
  'The engine has no comparison for this kind of value yet, so the check would never match.';

/**
 * The hand-written condition rows, in catalogue order.
 *
 * A subtype that names a task field is the field key itself, because that is
 * what the runner looks up: `conditionHolds` reads `configuration.field` and
 * falls back to the node's subtype. A row whose subtype is a description rather
 * than a key is one the engine has no field for, which is why every one of them
 * carries a reason.
 */
const CONDITION_SPECS: readonly ConditionSpec[] = [
  // Task moved
  {
    subtype: 'sectionId',
    label: 'Task is in section…',
    category: CONDITION_CATEGORY.TASK_MOVED,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
  },
  {
    subtype: 'ADDED_BY_FORM',
    label: 'Task is added to this project by form…',
    category: CONDITION_CATEGORY.TASK_MOVED,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    reason: FORMS_AND_EMAIL_REASON,
  },
  {
    subtype: 'ADDED_BY_EMAIL',
    label: 'Task is added to this project by email…',
    category: CONDITION_CATEGORY.TASK_MOVED,
    valueType: CONDITION_VALUE_TYPE.TEXT,
    reason: FORMS_AND_EMAIL_REASON,
  },

  // Task field is
  {
    subtype: 'assigneeId',
    label: 'Assignee is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.PEOPLE,
  },
  {
    subtype: 'createdById',
    label: 'Task creator is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.PEOPLE,
  },
  {
    subtype: 'title',
    label: 'Task name is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.TEXT,
  },
  {
    subtype: 'description',
    label: 'Task description is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.TEXT,
  },
  {
    subtype: 'dueDate',
    label: 'Due date is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.DATE,
  },
  {
    subtype: 'startDate',
    label: 'Start date is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.DATE,
  },
  {
    subtype: 'estimatedMinutes',
    label: 'Estimate is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.NUMBER,
    description: 'In minutes, as the estimate column holds it.',
  },
  {
    subtype: 'createdAt',
    label: 'Created is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.DATE,
  },
  {
    subtype: 'completedAt',
    label: 'Completed on is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.DATE,
    description: 'The day the task was marked complete; empty while it is open.',
  },
  /*
   * Priority is not in the specified list and is kept anyway: the runner reads
   * it, the old catalogue offered it, and dropping a working check to match a
   * screenshot would take a capability away from every rule already using it.
   */
  {
    subtype: 'priority',
    label: 'Priority is…',
    category: CONDITION_CATEGORY.TASK_FIELD,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
  },

  // Status is
  /* Kept for the same reason as priority above. */
  {
    subtype: 'status',
    label: 'Status is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
  },
  {
    subtype: 'TASK_TYPE',
    label: 'Task type is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    reason: 'A task and a ticket are separate records here, so a task carries no type to compare.',
  },
  {
    subtype: 'completed',
    label: 'Task or all subtasks completion status is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.CHECKBOX,
    /*
     * The runner reads both halves of the label: `completedAt` on the task the
     * event is about, and — on the roll-up event raised for a parent whose last
     * open subtask was just completed — the event itself. It compares them with
     * "is checked", which it evaluates directly; a rule that says
     * `completed IS true` over the API publishes and runs as well.
     */
    description: 'Holds when this task is complete, or when its last open subtask just was.',
  },
  {
    subtype: 'TICKET',
    label: 'Ticket is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    reason: TASK_ALONE_REASON,
  },
  {
    subtype: 'APPROVAL_STATUS',
    label: 'Approval status is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    reason: NO_APPROVALS_REASON,
  },
  {
    subtype: 'NO_LONGER_BLOCKED',
    label: 'Task is no longer blocked',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.CHECKBOX,
    /*
     * Two things missing at once, and both matter. There are no blocking
     * relationships between tasks — only a `BLOCKED` status — and a condition
     * tests what is true now rather than what changed, so even with them this
     * would need a trigger rather than a check.
     */
    reason:
      'Nothing blocks one task on another here, and a condition tests what is true now rather than what just changed.',
  },

  // Task details
  {
    subtype: 'IN_ANY_PROJECT',
    label: 'Task is in any of these projects…',
    category: CONDITION_CATEGORY.TASK_DETAILS,
    valueType: CONDITION_VALUE_TYPE.MULTI_SELECT,
    reason: 'A rule belongs to one project and only ever sees that project’s events.',
  },

  // Task has
  {
    subtype: 'HAS_ATTACHMENT',
    label: 'Task has an attachment',
    category: CONDITION_CATEGORY.TASK_HAS,
    valueType: CONDITION_VALUE_TYPE.CHECKBOX,
    reason: TASK_ALONE_REASON,
  },
  {
    subtype: 'HAS_COMMENT',
    label: 'Task has a comment',
    category: CONDITION_CATEGORY.TASK_HAS,
    valueType: CONDITION_VALUE_TYPE.CHECKBOX,
    reason: TASK_ALONE_REASON,
  },

  // Create your own
  {
    subtype: 'AI_CONDITION',
    label: 'Create conditional check with AI',
    category: CONDITION_CATEGORY.CREATE_YOUR_OWN,
    valueType: CONDITION_VALUE_TYPE.TEXT,
    reason: 'Coming later.',
  },
];

/** What a custom field's type means for the operators its condition may use. */
const VALUE_TYPE_BY_FIELD_TYPE: Record<string, ConditionValueType> = {
  TEXT: CONDITION_VALUE_TYPE.TEXT,
  NUMBER: CONDITION_VALUE_TYPE.NUMBER,
  // A rating is a bounded whole number; the comparisons are the number ones.
  RATING: CONDITION_VALUE_TYPE.NUMBER,
  DATE: CONDITION_VALUE_TYPE.DATE,
  CHECKBOX: CONDITION_VALUE_TYPE.CHECKBOX,
  SINGLE_SELECT: CONDITION_VALUE_TYPE.SINGLE_SELECT,
  MULTI_SELECT: CONDITION_VALUE_TYPE.MULTI_SELECT,
  PEOPLE: CONDITION_VALUE_TYPE.PEOPLE,
  // A URL and an address are text with a stricter shape; the comparisons a
  // person wants on them — contains, starts with — are the text ones.
  URL: CONDITION_VALUE_TYPE.TEXT,
  EMAIL: CONDITION_VALUE_TYPE.TEXT,
};

/**
 * The condition catalogue for one project.
 *
 * The generated rows sit in the middle rather than at the end because the
 * catalogue's order is the order the groups are read in, and "Custom field is"
 * comes before "Task has".
 */
export function conditionCatalogue(
  fields: readonly CatalogueCustomField[],
): AutomationConditionEntry[] {
  const generated: AutomationConditionEntry[] = settable(fields).map((field) => ({
    ...toConditionEntry({
      subtype: customFieldKey(field.id),
      label: `${field.name} is…`,
      category: CONDITION_CATEGORY.CUSTOM_FIELD,
      /*
       * No refusal of its own — every type falls to the readable/comparable
       * derivation like the hand-written rows. The many-valued types used to
       * carry one here ("the engine compares one at a time"), which stopped
       * being true when `conditionHolds` learned to read "is set to X" against
       * a set as membership.
       */
      valueType: VALUE_TYPE_BY_FIELD_TYPE[field.type] ?? CONDITION_VALUE_TYPE.TEXT,
    }),
    // The card renders the name as a token rather than baking it into the
    // label, so the words and the field they name stay distinguishable.
    fieldId: field.id,
    fieldName: field.name,
  }));

  const entries: AutomationConditionEntry[] = [];

  for (const category of Object.values(CONDITION_CATEGORY)) {
    if (category === CONDITION_CATEGORY.CUSTOM_FIELD) {
      entries.push(...generated);
      continue;
    }

    entries.push(
      ...CONDITION_SPECS.filter((spec) => spec.category === category).map(toConditionEntry),
    );
  }

  return entries;
}

/**
 * The key a custom-field condition is stored under.
 *
 * Matches `AutomationConditionDefinition.fieldKey`, which already documents this
 * shape — one convention for the same idea rather than two that have to be
 * translated between.
 */
export function customFieldKey(fieldId: string): string {
  return `customField:${fieldId}`;
}

function toConditionEntry(spec: ConditionSpec): AutomationConditionEntry {
  /*
   * Three answers, most specific first.
   *
   * The spec's own reason wins where it has one, because "there are no
   * approvals" is a better answer than "the engine cannot read this". After
   * that come the two halves of evaluating a condition — reading the field, and
   * comparing what was read — because a row that fails either is a row whose
   * only product is a rule that quietly does nothing.
   *
   * Never null while unavailable: the fallbacks are generic, but a generic
   * explanation is still an explanation, and a greyed row with none is the
   * thing this catalogue exists to avoid.
   */
  const reason =
    spec.reason ??
    (!runnerCanReadField(spec.subtype)
      ? UNREADABLE_FIELD_REASON
      : !runnerCanCompare(spec.subtype, spec.valueType)
        ? UNCOMPARABLE_FIELD_REASON
        : null);

  return {
    subtype: spec.subtype,
    label: spec.label,
    description: spec.description ?? '',
    category: spec.category,
    valueType: spec.valueType,
    available: reason === null,
    reason,
  };
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One action row before its availability is worked out.
 *
 * No `available`: it is `runnerCanPerform(subtype)`, always. A subtype the
 * engine implements is available and one it does not is not, and there is no
 * third case for this shape to express.
 */
interface ActionSpec {
  subtype: string;
  label: string;
  category: string;
  reason?: string;
  description?: string;
}

const NEEDS_VARIABLES_REASON =
  'Text-setting actions wait on variables — one that can only write a constant would give every task it touches the same words.';

/**
 * The hand-written action rows, in catalogue order.
 *
 * The specified entries come first in each group and the ones this list did not
 * name are appended to the group that fits them. Appended rather than dropped:
 * losing a working action to match a picture would be a regression, and losing
 * it silently would be one nobody noticed.
 */
const ACTION_SPECS: readonly ActionSpec[] = [
  // Move task
  {
    subtype: AutomationAction.MOVE_TO_SECTION,
    label: 'Move to a section…',
    category: ACTION_CATEGORY.MOVE_TASK,
    description: 'The section is re-checked against this project when the rule runs.',
  },
  {
    subtype: AutomationAction.MOVE_TO_PROJECT,
    label: 'Move to another project…',
    category: ACTION_CATEGORY.MOVE_TASK,
    /*
     * What becomes of what the task carries is decided in the runner, and the
     * description says the half somebody building the rule needs: the task
     * lands in a section of the chosen project and keeps its field values.
     * Only a move — a task lives in one project here, so there is no "add".
     */
    description:
      'The task keeps its fields and lands in the chosen section, or the project’s first one.',
  },
  {
    subtype: 'REMOVE_FROM_PROJECT',
    label: 'Remove task from the project',
    category: ACTION_CATEGORY.MOVE_TASK,
    reason: 'No action detaches a task from its project.',
  },

  // Change status
  {
    subtype: 'AI_DRAFT_UPDATE',
    label: 'Draft an update with AI…',
    category: ACTION_CATEGORY.CHANGE_STATUS,
    reason: 'Coming later.',
  },
  {
    subtype: 'SET_COMPLETION',
    label: 'Change completion status to…',
    category: ACTION_CATEGORY.CHANGE_STATUS,
    /*
     * Not a missing action so much as a different model. Completion is derived
     * here: `UPDATE_STATUS` stamps `completedAt` when the status becomes Done
     * and there is no flag to set on its own — and nothing clears it, so the
     * "not complete" half would not work even if the flag were exposed.
     */
    reason:
      'Completion follows the status here: setting the status to Done marks the task complete, and there is no separate flag to set or clear.',
  },
  {
    subtype: 'SET_TICKET',
    label: 'Set Ticket to…',
    category: ACTION_CATEGORY.CHANGE_STATUS,
    reason: 'No automation action writes a ticket; the engine acts on the task an event is about.',
  },
  {
    subtype: AutomationAction.UPDATE_STATUS,
    label: ACTION_LABEL.UPDATE_STATUS,
    category: ACTION_CATEGORY.CHANGE_STATUS,
    description: 'Setting the status to Done also marks the task complete.',
  },

  // Change task field to…
  {
    subtype: AutomationAction.ASSIGN_USER,
    label: 'Change assignee to…',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    description: 'Membership is re-checked when the rule runs, not when it is written.',
  },
  {
    subtype: AutomationAction.SET_DUE_DATE,
    label: 'Change due date to…',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    // A fixed date written into a rule is stale the week after; "in three days"
    // stays meaningful for as long as the rule exists.
    description: 'Takes a number of days from now rather than a fixed date.',
  },
  {
    subtype: 'SET_TASK_NAME',
    label: 'Set task name to',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    reason: NEEDS_VARIABLES_REASON,
  },
  {
    subtype: 'SET_TASK_DESCRIPTION',
    label: 'Set task description to',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    reason: NEEDS_VARIABLES_REASON,
  },
  {
    subtype: AutomationAction.UNASSIGN_USER,
    label: ACTION_LABEL.UNASSIGN_USER,
    category: ACTION_CATEGORY.CHANGE_FIELD,
  },
  {
    subtype: AutomationAction.UPDATE_PRIORITY,
    label: ACTION_LABEL.UPDATE_PRIORITY,
    category: ACTION_CATEGORY.CHANGE_FIELD,
  },
  {
    subtype: AutomationAction.CLEAR_DUE_DATE,
    label: ACTION_LABEL.CLEAR_DUE_DATE,
    category: ACTION_CATEGORY.CHANGE_FIELD,
  },
  {
    subtype: AutomationAction.SET_START_DATE,
    label: 'Change start date to…',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    description: 'Takes a number of days from now rather than a fixed date.',
  },
  {
    subtype: AutomationAction.CLEAR_START_DATE,
    label: ACTION_LABEL.CLEAR_START_DATE,
    category: ACTION_CATEGORY.CHANGE_FIELD,
  },
  {
    subtype: AutomationAction.SET_ESTIMATE,
    label: 'Change estimate to…',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    description: 'A whole number of minutes.',
  },

  // Create new
  {
    subtype: 'CREATE_TASK',
    label: 'Create a task…',
    category: ACTION_CATEGORY.CREATE_NEW,
    reason:
      'The engine can create a subtask of the task it is acting on, but not a task beside it.',
  },
  {
    subtype: AutomationAction.CREATE_SUBTASK,
    label: 'Create subtasks…',
    category: ACTION_CATEGORY.CREATE_NEW,
    description:
      'Creates the listed subtasks in the parent’s project and section, each with its own assignee and due date where you set them.',
  },
  {
    subtype: 'CREATE_APPROVALS',
    label: 'Create approvals…',
    category: ACTION_CATEGORY.CREATE_NEW,
    reason: NO_APPROVALS_REASON,
  },

  // Convert task to…
  {
    subtype: 'CONVERT_TO_PROJECT',
    label: 'Convert task to project',
    category: ACTION_CATEGORY.CONVERT,
    reason:
      'A project is not a heavier task in this data model, so there is nothing to convert to.',
  },
  {
    subtype: 'SET_TASK_TYPE',
    label: 'Set task type to',
    category: ACTION_CATEGORY.CONVERT,
    reason: 'A task and a ticket are separate records here; a task has no type to set.',
  },

  // Add to task
  {
    subtype: AutomationAction.ADD_COMMENT,
    label: 'Add comment',
    category: ACTION_CATEGORY.ADD_TO_TASK,
    description: 'Authored by whoever caused the trigger, falling back to the task’s creator.',
  },
  {
    subtype: 'ADD_REMOVE_COLLABORATORS',
    label: 'Add or remove collaborators',
    category: ACTION_CATEGORY.ADD_TO_TASK,
    reason: 'A task has an assignee here, and no collaborator list to add anyone to.',
  },
  {
    subtype: AutomationAction.SEND_IN_APP_NOTIFICATION,
    label: ACTION_LABEL.SEND_IN_APP_NOTIFICATION,
    category: ACTION_CATEGORY.ADD_TO_TASK,
    description: 'Notifies the configured person, or the assignee when none is chosen.',
  },
];

/** The generic answer for a subtype the engine simply has no code for. */
const NOT_IMPLEMENTED_REASON = 'This is not an action the engine can run yet.';

/** The action catalogue for one project, custom fields generated in place. */
export function actionCatalogue(fields: readonly CatalogueCustomField[]): AutomationCatalogEntry[] {
  const generated: AutomationCatalogEntry[] = settable(fields).map((field) => ({
    ...toActionEntry({
      subtype: AutomationAction.SET_CUSTOM_FIELD,
      label: `Change ${field.name} to…`,
      category: ACTION_CATEGORY.CHANGE_CUSTOM_FIELD,
    }),
    fieldId: field.id,
    fieldName: field.name,
  }));

  const entries: AutomationCatalogEntry[] = [];

  for (const category of Object.values(ACTION_CATEGORY)) {
    if (category === ACTION_CATEGORY.CHANGE_CUSTOM_FIELD) {
      entries.push(...generated);
      continue;
    }

    entries.push(...ACTION_SPECS.filter((spec) => spec.category === category).map(toActionEntry));
  }

  return entries;
}

function toActionEntry(spec: ActionSpec): AutomationCatalogEntry {
  // The executable list is the whole answer. A row cannot claim to work by
  // being written optimistically, and publishing validates against the same
  // list, so nothing can be offered here and refused there.
  const available = runnerCanPerform(spec.subtype);

  return {
    subtype: spec.subtype,
    label: spec.label,
    description: spec.description ?? '',
    category: spec.category,
    available,
    reason: available ? null : (spec.reason ?? NOT_IMPLEMENTED_REASON),
  };
}

/* -------------------------------------------------------------------------- */
/* Capabilities and permissions                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the engine can do, read off the same facts the catalogue uses.
 *
 * Derived wherever there is something to derive from, so a capability cannot
 * claim more than the action list supports. The two that are stated rather than
 * computed are pinned by name to the code that decides them: the runner walks a
 * branch's arms in `plan`, and the validator refuses a DELAY node outright in
 * `checkSubtypes` — so neither can change without this line being read.
 */
export function capabilities(): AutomationCapabilities {
  return {
    branching: true,
    delays: false,
    externalActions: runnerCanPerform('SEND_EMAIL') || runnerCanPerform('SEND_WEBHOOK'),
    ai: runnerCanPerform('AI_ACTION'),
    conditionsOnCustomFields: runnerCanReadField(customFieldKey('any')),
    actionsOnCustomFields: runnerCanPerform(AutomationAction.SET_CUSTOM_FIELD),
    maxActionsPerExecution: MAX_ACTIONS_PER_EXECUTION,
    maxRuleDepth: MAX_AUTOMATION_DEPTH,
  };
}

/**
 * What this caller may do, mirroring `AutomationsService.assertMayManage`.
 *
 * Sent so the builder can present a rule as read-only rather than let somebody
 * write one and meet a 403 on save. It is not the check — the service still
 * refuses — because a permission a client is told about is a permission a client
 * could lie about.
 */
export function permissionsFor(role: WorkspaceRole, mayManage: boolean): AutomationPermissions {
  return {
    role,
    // Reaching this endpoint at all means membership; the guard saw to that.
    canView: true,
    canCreate: mayManage,
    canEdit: mayManage,
    canPublish: mayManage,
    canDelete: mayManage,
  };
}
