import {
  ACTION_LABEL,
  AUTOMATION_ACTIONS,
  AUTOMATION_SELECTOR_CATEGORY,
  AUTOMATION_TRIGGERS,
  AutomationAction,
  AutomationTrigger,
  CONDITION_OPERATOR,
  CONDITION_VALUE_TYPE,
  MAX_ACTIONS_PER_EXECUTION,
  MAX_AUTOMATION_DEPTH,
  TRIGGER_CONFIG_FORM,
  TRIGGER_CONFIG_FORM_LABEL,
  TRIGGER_CONFIG_FORMS_BY_TRIGGER,
  TRIGGER_LABEL,
  operatorNeedsValue,
  operatorTakesMultipleValues,
  type ConditionOperator,
  type ConditionValueType,
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
  'completed',
  'dueDate',
  'startDate',
];

const READABLE = new Set(READABLE_TASK_FIELDS);

/**
 * Whether the runner can evaluate a condition about this field key.
 *
 * One rule for the hand-written entries and the generated custom-field ones
 * alike. Custom fields are absent from the set deliberately rather than by
 * omission: their values live in `task_custom_field_values`, a table the runner
 * never loads, so no key of the form `customField:<id>` can ever resolve.
 */
export function runnerCanReadField(fieldKey: string): boolean {
  return READABLE.has(fieldKey);
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
  TASK_MOVED: 'Task moved',
  TASK_FIELD: 'Task field is',
  STATUS: 'Status is',
  TASK_DETAILS: 'Task details',
  CUSTOM_FIELD: 'Custom field is',
  TASK_HAS: 'Task has',
  CREATE_YOUR_OWN: 'Create your own',
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
};

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
 * The order the trigger picker reads its groups in.
 *
 * Needed because the entries come out in enum order, and enum order interleaves
 * the categories — "Status and workflow" appeared twice with Assignment between
 * the halves. A client grouping in array order, which is what the condition and
 * action catalogues expect it to do, would draw that heading twice.
 */
const TRIGGER_CATEGORY_ORDER: readonly string[] = [
  AUTOMATION_SELECTOR_CATEGORY.WORK_ITEM,
  AUTOMATION_SELECTOR_CATEGORY.WORKFLOW,
  AUTOMATION_SELECTOR_CATEGORY.ASSIGNMENT,
  AUTOMATION_SELECTOR_CATEGORY.FIELDS,
  AUTOMATION_SELECTOR_CATEGORY.COMMUNICATION,
];

/**
 * Every declared trigger, grouped, with the shapes its configuration may take.
 *
 * Only `TASK_MOVED_TO_SECTION` offers forms. The rest need no narrowing beyond
 * the event itself, and an empty array on each of them would be one more list to
 * hold in step with the trigger enum for nothing.
 */
export function triggerCatalogue(): AutomationTriggerEntry[] {
  const entries = AUTOMATION_TRIGGERS.map((subtype) => {
    const reason = TRIGGER_UNAVAILABLE_REASON[subtype] ?? null;

    return {
      subtype,
      label: TRIGGER_LABEL[subtype],
      /*
       * Empty rather than a copy of the label, which is what it used to be —
       * invisible while the picker showed one of them, a stutter now that it
       * shows both. Nothing useful is known to say here, and saying nothing is
       * the honest version of that.
       */
      description: '',
      category: triggerCategory(subtype),
      available: reason === null,
      reason,
      configForms: configFormsFor(subtype),
    };
  });

  // Grouped by category, enum order preserved inside each — so the list stays
  // the one somebody already knows, only gathered.
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
 * The trigger picker is still grouped by `AUTOMATION_SELECTOR_CATEGORY`; only
 * the condition and action catalogues were respecified. Changing this one too
 * would be a rewording nobody asked for.
 */
function triggerCategory(trigger: AutomationTrigger): string {
  const byTrigger: Partial<Record<AutomationTrigger, string>> = {
    COMMENT_ADDED: AUTOMATION_SELECTOR_CATEGORY.COMMUNICATION,
    TASK_ASSIGNED: AUTOMATION_SELECTOR_CATEGORY.ASSIGNMENT,
    CUSTOM_FIELD_CHANGED: AUTOMATION_SELECTOR_CATEGORY.FIELDS,
    TASK_STATUS_CHANGED: AUTOMATION_SELECTOR_CATEGORY.WORKFLOW,
    TASK_PRIORITY_CHANGED: AUTOMATION_SELECTOR_CATEGORY.WORKFLOW,
    TASK_MOVED_TO_SECTION: AUTOMATION_SELECTOR_CATEGORY.WORKFLOW,
    TASK_COMPLETED: AUTOMATION_SELECTOR_CATEGORY.WORKFLOW,
  };

  return byTrigger[trigger] ?? AUTOMATION_SELECTOR_CATEGORY.WORK_ITEM;
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
const NO_APPROVALS_REASON = 'CoreTask has no approvals.';
const TASK_ALONE_REASON =
  'The engine loads the task an event is about and nothing beside it, so this cannot be checked.';

/** The generic answer, for a field the runner has no case for. */
const UNREADABLE_FIELD_REASON =
  'The engine cannot read this on a task, so the check would never match.';

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
    /*
     * The one field in this group the runner cannot reach. `readField` has a
     * case for the title and none for the description, so the comparison would
     * read `undefined` and quietly fail on every task — which is why it is
     * greyed rather than offered and left to disappoint somebody later.
     */
    reason: 'The engine reads a task’s name but not its description.',
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
     * Available, but only for half of what the label promises. The runner reads
     * `completedAt` on the task the event is about and never loads its
     * subtasks, so the roll-up is not checked. Said here rather than left to be
     * discovered: `reason` explains an unavailable row, and this row works.
     */
    description: 'Checks this task’s own completion. Whether its subtasks are all complete is not.',
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

/**
 * Why a custom field cannot be asked about, though it can be written.
 *
 * The asymmetry is real rather than an oversight: `SET_CUSTOM_FIELD` upserts
 * into `task_custom_field_values`, and `readField` never reads that table. So
 * the same field is an available action and an unavailable condition, and
 * saying which is which is the only way that stops looking like a bug.
 */
const CUSTOM_FIELD_CONDITION_REASON =
  'A condition reads the task’s own columns, and custom field values are not among them.';

/** What a custom field's type means for the operators its condition may use. */
const VALUE_TYPE_BY_FIELD_TYPE: Record<string, ConditionValueType> = {
  TEXT: CONDITION_VALUE_TYPE.TEXT,
  NUMBER: CONDITION_VALUE_TYPE.NUMBER,
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
  const generated: AutomationConditionEntry[] = fields.map((field) => ({
    ...toConditionEntry({
      subtype: customFieldKey(field.id),
      label: `${field.name} is…`,
      category: CONDITION_CATEGORY.CUSTOM_FIELD,
      valueType: VALUE_TYPE_BY_FIELD_TYPE[field.type] ?? CONDITION_VALUE_TYPE.TEXT,
      reason: CUSTOM_FIELD_CONDITION_REASON,
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
  // The spec's own reason wins where it has one, because "there are no
  // approvals" is a better answer than "the engine cannot read this".
  const available = spec.reason === undefined && runnerCanReadField(spec.subtype);

  return {
    subtype: spec.subtype,
    label: spec.label,
    description: spec.description ?? '',
    category: spec.category,
    valueType: spec.valueType,
    available,
    // Never null while unavailable: the fallback is generic, but a generic
    // explanation is still an explanation, and a greyed row with none is the
    // thing this catalogue exists to avoid.
    reason: available ? null : (spec.reason ?? UNREADABLE_FIELD_REASON),
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
    subtype: 'MOVE_PROJECT',
    label: 'Move or add to project…',
    category: ACTION_CATEGORY.MOVE_TASK,
    reason:
      'A task’s section, field values and view position all belong to its current project, and nothing yet decides what becomes of them on a move.',
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
    // Plural in the catalogue, singular in the engine. Worth saying, because
    // the label is what somebody plans around.
    description: 'Creates one subtask with a fixed title, in the parent’s project and section.',
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
  const generated: AutomationCatalogEntry[] = fields.map((field) => ({
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
