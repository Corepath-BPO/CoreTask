import {
  ACTION_LABEL,
  AUTOMATION_ACTIONS,
  AutomationAction,
  AutomationTrigger,
  EXTERNAL_ACTION_CATEGORY,
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
  TICKET_ONLY_ACTIONS,
  TICKET_RULE_ACTIONS,
  isTicketTrigger,
  TicketConditionField,
  isTicketConditionField,
  DELAY_SUBTYPE,
  AI_CHECK_FIELD,
  AI_UNAVAILABLE_REASON,
} from '@coretask/contracts';
import type { AutomationCapabilities, AutomationCatalogEntry } from '@coretask/types';

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
  // Facts the runner counts when it loads the task — see `TaskFacts`.
  'HAS_ATTACHMENT',
  'HAS_COMMENT',
  'NO_LONGER_BLOCKED',
  'TASK_TYPE',
  'APPROVAL_STATUS',
  'IS_SUBTASK',
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
  HAS_ATTACHMENT: ConditionValueKind.BOOLEAN,
  HAS_COMMENT: ConditionValueKind.BOOLEAN,
  NO_LONGER_BLOCKED: ConditionValueKind.BOOLEAN,
  TASK_TYPE: ConditionValueKind.ENUM,
  APPROVAL_STATUS: ConditionValueKind.ENUM,
  IS_SUBTASK: ConditionValueKind.BOOLEAN,
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
  /** "Use AI…": instructions, and the changes a model may make from them. */
  USE_AI: 'Use AI',
  /** The Wait step: what follows it runs later. */
  WAIT: 'Wait',
  /** Actions that leave CoreTask. The builder shows this group on its own tab. */
  EXTERNAL: EXTERNAL_ACTION_CATEGORY,
} as const;

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Triggers nothing publishes, and why.
 *
 * Everything else in `AUTOMATION_TRIGGERS` reaches the queue from
 * `TasksService`, `ProjectWorkItemService`, `CustomFieldsService` or
 * `CommentsService` — checked against the `automation.publish` call sites
 * rather than assumed. A trigger with no publisher is the quietest failure the
 * builder can sell: the rule saves, publishes, validates, and then waits
 * forever for an event that is never sent.
 */
const TRIGGER_UNAVAILABLE_REASON: Partial<Record<AutomationTrigger, string>> = {};

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
 * The forms `AutomationRunnerService.triggerMatches` can honour — all four.
 *
 * It reads the stored `form` before the section: a rule saved as "section is
 * not Done" must never fall through to the equality test and fire on exactly
 * the moves it was written to exclude. Kept as a list so a fifth form starts
 * out unavailable until the runner reads it.
 */
const RUNNABLE_TRIGGER_FORMS: readonly TriggerConfigForm[] = [
  TRIGGER_CONFIG_FORM.SECTION_CHANGED,
  TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO,
  TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_NOT,
  TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_ANY_OF,
];

const TRIGGER_FORM_REASON = 'The engine cannot match a move this way yet.';

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
  RUN_MANUALLY: 'Rule is run manually',
  SCHEDULED_TIME: 'Scheduled time occurs…',
  DUE_DATE_APPROACHING: 'Due date is approaching',
  TASK_OVERDUE: 'Task is overdue',
  START_DATE_APPROACHING: 'Start date is approaching',
  START_DATE_PASSED: 'Start date has passed',
  TASK_NO_LONGER_BLOCKED: 'Task is no longer blocked',
  ATTACHMENT_ADDED: 'Attachment is added',
  COLLABORATOR_ADDED: 'Collaborator is added',
  TASK_TYPE_CHANGED: 'Task type is changed',
  APPROVAL_STATUS_CHANGED: 'Approval status is changed',
  CUSTOM_DATE_APPROACHING: 'A date field is approaching',
  CUSTOM_DATE_PASSED: 'A date field is overdue',
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
    'Fires when a task is created in this project, or added to it from another project.',
  TASK_COMPLETED:
    'Fires when the task itself is completed, or when the last of its open subtasks is.',
  RUN_MANUALLY: 'Appears under Run rule in a task’s “…” menu, for anyone who can edit the project.',
  SCHEDULED_TIME:
    'Runs on a schedule, on the tasks you choose — or on none, to create new ones each time.',
  DUE_DATE_APPROACHING: 'Fires the morning a set number of days before a task is due.',
  TASK_OVERDUE: 'Fires once the due date has passed — at the due time, when the task has one.',
  START_DATE_APPROACHING: 'Fires the morning a set number of days before a task starts.',
  START_DATE_PASSED: 'Fires the morning the start date arrives.',
  TASK_NO_LONGER_BLOCKED:
    'Fires when the last unfinished task blocking it is completed or the dependency is removed.',
  COLLABORATOR_ADDED: 'Fires when somebody new starts following the task.',
  TASK_TYPE_CHANGED: 'Fires when a task is converted to a milestone, an approval, or back.',
  CUSTOM_DATE_APPROACHING:
    'Fires the morning a set number of days before the date in a custom date field.',
  CUSTOM_DATE_PASSED: 'Fires once the day in a custom date field is over.',
  APPROVAL_STATUS_CHANGED:
    'Fires when an approval is approved, rejected, or sent back for changes.',
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

const PLANNED_TRIGGER_SPECS: readonly PlannedTriggerSpec[] = [];

/**
 * Asana's per-field trigger rows, generated from the project's own fields.
 *
 * Each is a real trigger with the field pre-filled — the same shape the
 * generated `SET_CUSTOM_FIELD` action rows use. "[Field] is changed" is
 * `CUSTOM_FIELD_CHANGED`, which the runner narrows on that `fieldId`; a date
 * field's "is approaching" and "is overdue" are the clock's two custom-date
 * triggers, which read that field's value.
 */
function customFieldTriggerRows(fields: readonly CatalogueCustomField[]): AutomationTriggerEntry[] {
  return settable(fields).flatMap((field) => {
    const row = (subtype: AutomationTrigger, label: string): AutomationTriggerEntry => ({
      subtype,
      label,
      description: '',
      category: TRIGGER_GROUP.CUSTOM_FIELD_CHANGED,
      available: true,
      reason: null,
      configForms: [],
      fieldId: field.id,
      fieldName: field.name,
    });

    return [
      row(AutomationTrigger.CUSTOM_FIELD_CHANGED, `${field.name} is changed`),
      // Only a date can approach or pass.
      ...(field.type === 'DATE'
        ? [
            row(AutomationTrigger.CUSTOM_DATE_APPROACHING, `${field.name} is approaching`),
            row(AutomationTrigger.CUSTOM_DATE_PASSED, `${field.name} is overdue`),
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
  AutomationTrigger.RUN_MANUALLY,
  AutomationTrigger.SCHEDULED_TIME,
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
  AutomationTrigger.DUE_DATE_APPROACHING,
  AutomationTrigger.TASK_OVERDUE,
  AutomationTrigger.TASK_START_DATE_CHANGED,
  AutomationTrigger.START_DATE_APPROACHING,
  AutomationTrigger.START_DATE_PASSED,
  AutomationTrigger.TASK_TYPE_CHANGED,
  AutomationTrigger.TASK_STATUS_CHANGED,
  AutomationTrigger.APPROVAL_STATUS_CHANGED,
  AutomationTrigger.TICKET_STATUS_CHANGED,
  AutomationTrigger.TASK_COMPLETED,
  AutomationTrigger.TASK_NO_LONGER_BLOCKED,
  AutomationTrigger.CUSTOM_FIELD_CHANGED,
  AutomationTrigger.CUSTOM_DATE_APPROACHING,
  AutomationTrigger.CUSTOM_DATE_PASSED,
  AutomationTrigger.COMMENT_ADDED,
  AutomationTrigger.ATTACHMENT_ADDED,
  AutomationTrigger.COLLABORATOR_ADDED,
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
      subjects: isTicketTrigger(subtype) ? ['TICKET' as const] : ['TASK' as const],
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
    RUN_MANUALLY: TRIGGER_GROUP.UNGROUPED,
    SCHEDULED_TIME: TRIGGER_GROUP.UNGROUPED,
    DUE_DATE_APPROACHING: TRIGGER_GROUP.DUE_DATE,
    TASK_OVERDUE: TRIGGER_GROUP.DUE_DATE,
    START_DATE_APPROACHING: TRIGGER_GROUP.START_DATE,
    START_DATE_PASSED: TRIGGER_GROUP.START_DATE,
    TASK_NO_LONGER_BLOCKED: TRIGGER_GROUP.STATUS_CHANGED,
    ATTACHMENT_ADDED: TRIGGER_GROUP.ADDED_TO_TASK,
    COLLABORATOR_ADDED: TRIGGER_GROUP.ADDED_TO_TASK,
    TASK_TYPE_CHANGED: TRIGGER_GROUP.FIELD_CHANGED,
    APPROVAL_STATUS_CHANGED: TRIGGER_GROUP.STATUS_CHANGED,
    CUSTOM_DATE_APPROACHING: TRIGGER_GROUP.CUSTOM_FIELD_CHANGED,
    CUSTOM_DATE_PASSED: TRIGGER_GROUP.CUSTOM_FIELD_CHANGED,
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

/*
 * Forms and email to a project both create tasks, but neither leaves a mark a
 * rule can read: a form's task does not record the form, and the inbound-mail
 * record is not something the runner looks up. Said plainly, with what does
 * work instead.
 */
const ADDED_BY_FORM_REASON =
  'A task does not record which form created it yet, so this cannot be checked. "Task is added to this project" fires for form tasks too.';
const ADDED_BY_EMAIL_REASON =
  'Rules cannot tell yet that a task came in by email, so this cannot be checked. "Task is added to this project" fires for emailed tasks too.';
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
    reason: ADDED_BY_FORM_REASON,
  },
  {
    subtype: 'ADDED_BY_EMAIL',
    label: 'Task is added to this project by email…',
    category: CONDITION_CATEGORY.TASK_MOVED,
    valueType: CONDITION_VALUE_TYPE.TEXT,
    reason: ADDED_BY_EMAIL_REASON,
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
    description: 'Task, milestone or approval.',
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
  // For ticket rules: the ticket's own fields, read by the ticket half of the runner.
  {
    subtype: TicketConditionField.TYPE,
    label: 'Ticket type is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    description: 'Bug, feature, support, question, maintenance or incident.',
  },
  {
    subtype: TicketConditionField.PRIORITY,
    label: 'Ticket priority is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    description: 'Low, medium, high or urgent.',
  },
  {
    subtype: TicketConditionField.SEVERITY,
    label: 'Ticket severity is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    description: 'Minor, major or critical.',
  },
  {
    subtype: TicketConditionField.STATUS,
    label: 'Ticket status is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    description: 'Open, triaged, in progress, waiting, resolved or closed.',
  },
  {
    subtype: TicketConditionField.ASSIGNEE,
    label: 'Ticket assignee is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.PEOPLE,
    description: 'Who the ticket is assigned to, or nobody.',
  },
  {
    subtype: 'APPROVAL_STATUS',
    label: 'Approval status is…',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.SINGLE_SELECT,
    description: 'Empty for anything that is not an approval.',
  },
  {
    subtype: 'NO_LONGER_BLOCKED',
    label: 'Task is no longer blocked',
    category: CONDITION_CATEGORY.STATUS,
    valueType: CONDITION_VALUE_TYPE.CHECKBOX,
    description: 'Holds when no unfinished task is blocking it.',
  },

  // Task details
  {
    subtype: 'IS_SUBTASK',
    label: 'Task is a subtask',
    category: CONDITION_CATEGORY.TASK_DETAILS,
    valueType: CONDITION_VALUE_TYPE.CHECKBOX,
    /*
     * A subtask is a task in its parent's project, so "a task is added to this
     * project" fires for every subtask made there, a rule's included. "Is not
     * checked" keeps a rule to the tasks a person sees in the list, as Asana's
     * own trigger does, and stops a rule that adds subtasks adding them under
     * the subtasks it, or another rule, has just made.
     */
    description: 'Holds for a subtask; “is not checked” keeps a rule to top-level tasks.',
  },
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
  },
  {
    subtype: 'HAS_COMMENT',
    label: 'Task has a comment',
    category: CONDITION_CATEGORY.TASK_HAS,
    valueType: CONDITION_VALUE_TYPE.CHECKBOX,
  },

  // Create your own
  {
    // Available or not with the model behind it — see `toConditionEntry`.
    subtype: AI_CHECK_FIELD,
    label: 'Create conditional check with AI',
    category: CONDITION_CATEGORY.CREATE_YOUR_OWN,
    valueType: CONDITION_VALUE_TYPE.TEXT,
    description:
      'Ask a yes-or-no question about the task; the rule goes on only if AI answers yes.',
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
  /** Whether a model is configured, which the AI check needs. */
  ai = false,
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
      ...CONDITION_SPECS.filter((spec) => spec.category === category).map((spec) =>
        toConditionEntry(spec, ai),
      ),
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

function toConditionEntry(spec: ConditionSpec, ai = false): AutomationConditionEntry {
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
  // A ticket's fields are read by the ticket half of the runner, not `readField`.
  const reason =
    spec.reason ??
    // An AI check needs nothing from the field readers, only a model.
    (spec.subtype === AI_CHECK_FIELD
      ? ai
        ? null
        : AI_UNAVAILABLE_REASON
      : isTicketConditionField(spec.subtype)
        ? null
        : !runnerCanReadField(spec.subtype)
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
    subjects: isTicketConditionField(spec.subtype) ? ['TICKET'] : ['TASK'],
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

const VARIABLES_DESCRIPTION =
  'Can name the task, its assignee, dates and project with variables like {{task.name}}.';

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
     * "Add" (`mode: 'ADD'`) keeps it here as well — multi-homing.
     */
    description:
      'Move the task, or add it there too; it lands in the chosen section, or the project’s first one.',
  },
  {
    subtype: AutomationAction.REMOVE_FROM_PROJECT,
    label: 'Remove task from the project',
    category: ACTION_CATEGORY.MOVE_TASK,
    description: 'The task leaves the project but keeps its assignee, so it stays in My Tasks.',
  },

  // Use AI
  {
    subtype: AutomationAction.AI_ACTION,
    label: 'Use AI…',
    category: ACTION_CATEGORY.USE_AI,
    description:
      'Write instructions; AI reads the task and makes the changes you allow, choosing from this project’s own options.',
  },

  // Change status
  {
    subtype: AutomationAction.AI_DRAFT_UPDATE,
    label: 'Draft an update with AI…',
    category: ACTION_CATEGORY.CHANGE_STATUS,
    description:
      'AI drafts the project’s status update from its own numbers and recent work, for its owner to review and post. Works on a schedule with no tasks.',
  },
  {
    subtype: AutomationAction.SET_COMPLETION,
    label: 'Change completion status to…',
    category: ACTION_CATEGORY.CHANGE_STATUS,
    /*
     * Completion follows the status here, so this moves the task to the
     * project's own Done status — or back to its first open one — and the
     * status change stamps or clears `completedAt` as any edit would.
     */
    description: 'Moves the task to the project’s Done status, or back to its first open one.',
  },
  {
    subtype: AutomationAction.SET_TICKET_STATUS,
    label: 'Set ticket status to…',
    category: ACTION_CATEGORY.CHANGE_STATUS,
    description:
      'For ticket rules. Resolving or closing stamps the ticket as a person’s change does.',
  },
  {
    subtype: AutomationAction.SET_TICKET_PRIORITY,
    label: 'Set ticket priority to…',
    category: ACTION_CATEGORY.CHANGE_STATUS,
    description: 'For ticket rules: Low, Medium, High or Urgent.',
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
    subtype: AutomationAction.ASSIGN_TEAM,
    label: 'Change team to…',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    description: 'Makes a team of this workspace responsible for the task, or clears it.',
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
    subtype: AutomationAction.SET_TASK_NAME,
    label: 'Set task name to',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    description: VARIABLES_DESCRIPTION,
  },
  {
    subtype: AutomationAction.SET_TASK_DESCRIPTION,
    label: 'Set task description to',
    category: ACTION_CATEGORY.CHANGE_FIELD,
    description: VARIABLES_DESCRIPTION,
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
    subtype: AutomationAction.CREATE_TASK,
    label: 'Create a task…',
    category: ACTION_CATEGORY.CREATE_NEW,
    description:
      'A new task in this project, with a name that can use variables, a section, an assignee and a due date.',
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
    reason: 'Use “Create a task…”, then “Set task type to” Approval — an approval starts pending.',
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
    subtype: AutomationAction.SET_TASK_TYPE,
    label: 'Set task type to',
    category: ACTION_CATEGORY.CONVERT,
    description: 'Converts to a task, a milestone or an approval — an approval starts pending.',
  },

  // Add to task
  {
    subtype: AutomationAction.ADD_COMMENT,
    label: 'Add comment',
    category: ACTION_CATEGORY.ADD_TO_TASK,
    description: 'Authored by whoever caused the trigger, falling back to the task’s creator.',
  },

  // Wait
  {
    subtype: DELAY_SUBTYPE,
    label: 'Wait…',
    category: ACTION_CATEGORY.WAIT,
    description:
      'Minutes, hours or days. What follows runs then, judged on the task as it is by that time.',
  },

  // Send to another tool
  {
    subtype: AutomationAction.SEND_EMAIL,
    label: 'Send an email…',
    category: ACTION_CATEGORY.EXTERNAL,
    description:
      'Emails the assignee, collaborators or creator, with a link to the task. Variables fill in the words.',
  },
  {
    subtype: AutomationAction.SEND_WEBHOOK,
    label: 'Send a webhook…',
    category: ACTION_CATEGORY.EXTERNAL,
    description:
      'POSTs the task as JSON to a webhook endpoint from Settings (signed), or to a URL you enter.',
  },
  {
    subtype: AutomationAction.ADD_REMOVE_COLLABORATORS,
    label: 'Add or remove collaborators',
    category: ACTION_CATEGORY.ADD_TO_TASK,
    description: 'Collaborators follow the task and hear about its comments and changes.',
  },
  {
    subtype: AutomationAction.SEND_IN_APP_NOTIFICATION,
    label: ACTION_LABEL.SEND_IN_APP_NOTIFICATION,
    category: ACTION_CATEGORY.ADD_TO_TASK,
    description: 'Notifies the configured person, or the assignee when none is chosen.',
  },
  {
    subtype: AutomationAction.CREATE_CHECKLIST,
    label: 'Checklist…',
    category: ACTION_CATEGORY.ADD_TO_TASK,
    description: 'Adds a named checklist with the items you list, each unticked.',
  },
];

/** The generic answer for a subtype the engine simply has no code for. */
const NOT_IMPLEMENTED_REASON = 'This is not an action the engine can run yet.';

/** The action catalogue for one project, custom fields generated in place. */
export function actionCatalogue(
  fields: readonly CatalogueCustomField[],
  /** Whether a model is configured, which "Use AI…" needs. */
  ai = false,
): AutomationCatalogEntry[] {
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

    entries.push(
      ...ACTION_SPECS.filter((spec) => spec.category === category).map((spec) =>
        toActionEntry(spec, ai),
      ),
    );
  }

  return entries;
}

function toActionEntry(spec: ActionSpec, ai = false): AutomationCatalogEntry {
  // The executable list is the whole answer. A row cannot claim to work by
  // being written optimistically, and publishing validates against the same
  // list, so nothing can be offered here and refused there.
  // The Wait step is a step of its own, not an action, and the runner takes it.
  // "Use AI…" runs when there is a model to run it, and publishing asks the same.
  const aiStep =
    spec.subtype === AutomationAction.AI_ACTION ||
    spec.subtype === AutomationAction.AI_DRAFT_UPDATE;
  const available = aiStep ? ai : runnerCanPerform(spec.subtype) || spec.subtype === DELAY_SUBTYPE;

  return {
    subtype: spec.subtype,
    label: spec.label,
    description: spec.description ?? '',
    category: spec.category,
    available,
    reason: available
      ? null
      : aiStep
        ? AI_UNAVAILABLE_REASON
        : (spec.reason ?? NOT_IMPLEMENTED_REASON),
    subjects: TICKET_ONLY_ACTIONS.includes(spec.subtype)
      ? ['TICKET']
      : TICKET_RULE_ACTIONS.includes(spec.subtype) || spec.subtype === DELAY_SUBTYPE
        ? ['TASK', 'TICKET']
        : ['TASK'],
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
 * branch's arms in `plan`, and stops at a Wait step there for the clock to
 * resume — so neither can change without this line being read.
 */
export function capabilities(
  /** Whether a model is configured; the AI steps run only with one. */
  ai = false,
): AutomationCapabilities {
  return {
    branching: true,
    delays: true,
    externalActions: runnerCanPerform('SEND_EMAIL') || runnerCanPerform('SEND_WEBHOOK'),
    ai: ai && runnerCanPerform(AutomationAction.AI_ACTION),
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
