import { AutomationTrigger } from './automation.js';

/**
 * The vocabulary of a rule as an ordered list of branches.
 *
 * The node graph in `automation-graph.ts` describes a rule as a tree, which is
 * what the canvas draws but not what a rule is: "otherwise if" has to be built
 * by nesting, so nothing in the data says these are the ordered alternatives of
 * one rule. This file names the structured model instead — branches, condition
 * groups, ordered actions — and mirrors the Prisma enums exactly, because a
 * value the builder can produce and the database cannot store is a save that
 * fails after the person has already done the work.
 *
 * The two vocabularies coexist deliberately while rules are migrated. Neither
 * is a rename of the other: `ConditionValueKind` and `FilterOperator` describe
 * saved-view filters and the legacy node conditions, and the operators here are
 * the wider set the rule builder offers. Merging them would mean either
 * offering view filters operators they cannot compile, or dropping the ones the
 * builder needs.
 */

/** How a rule's name is maintained. */
export const AutomationRuleNameMode = {
  /** Derived from the trigger, and re-derived when the trigger changes. */
  AUTO: 'AUTO',
  /** Somebody typed it. Never overwritten. */
  MANUAL: 'MANUAL',
} as const;
export type AutomationRuleNameMode =
  (typeof AutomationRuleNameMode)[keyof typeof AutomationRuleNameMode];
export const AUTOMATION_RULE_NAME_MODE_VALUES: readonly AutomationRuleNameMode[] =
  Object.values(AutomationRuleNameMode);

/** Which of a rule's ordered alternatives a branch is. */
export const AutomationBranchType = {
  /** The first one, with the rule's opening condition. */
  PRIMARY: 'PRIMARY',
  /** A further alternative, with its own condition. */
  OTHERWISE_IF: 'OTHERWISE_IF',
  /** The fallback. No condition, last, at most one. */
  OTHERWISE: 'OTHERWISE',
} as const;
export type AutomationBranchType = (typeof AutomationBranchType)[keyof typeof AutomationBranchType];
export const AUTOMATION_BRANCH_TYPE_VALUES: readonly AutomationBranchType[] =
  Object.values(AutomationBranchType);

/** Whether every condition in a group must hold, or any one of them. */
export const ConditionGroupOperator = {
  ALL: 'ALL',
  ANY: 'ANY',
} as const;
export type ConditionGroupOperator =
  (typeof ConditionGroupOperator)[keyof typeof ConditionGroupOperator];
export const CONDITION_GROUP_OPERATOR_VALUES: readonly ConditionGroupOperator[] =
  Object.values(ConditionGroupOperator);

/**
 * What each branch is called on the canvas.
 *
 * "Check if" rather than "Primary": the type is what the runner matches on and
 * the label is what somebody reads, and the moment one file uses the enum as
 * display text the wording can no longer be changed without a migration.
 */
export const BRANCH_TYPE_LABEL: Record<AutomationBranchType, string> = {
  PRIMARY: 'Check if',
  OTHERWISE_IF: 'Otherwise if',
  OTHERWISE: 'Otherwise',
};

/* -------------------------------------------------------------------------- */
/* Conditions                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a condition's value is, which is what makes its operators type-aware.
 *
 * "A date contains High" and "a checkbox is greater than 10" are combinations
 * a form should never offer, and the only way to know that is to know what the
 * field holds. Status and priority are `SINGLE_SELECT` — a fixed set of options
 * behaves identically whether the options are system or user-defined, and a
 * separate STATUS type would only duplicate the operator list.
 */
export const CONDITION_VALUE_TYPE = {
  TEXT: 'TEXT',
  SINGLE_SELECT: 'SINGLE_SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  PEOPLE: 'PEOPLE',
  DATE: 'DATE',
  NUMBER: 'NUMBER',
  CHECKBOX: 'CHECKBOX',
} as const;
export type ConditionValueType = (typeof CONDITION_VALUE_TYPE)[keyof typeof CONDITION_VALUE_TYPE];
export const CONDITION_VALUE_TYPE_VALUES: readonly ConditionValueType[] =
  Object.values(CONDITION_VALUE_TYPE);

/**
 * Every comparison a condition can make.
 *
 * Keys, not wording. `IS` and `EQUALS` are the same test on different types and
 * are kept apart because the sentence a person reads differs — "status is Done"
 * against "estimate equals 30" — and a single key would force one of the two to
 * read wrongly.
 */
export const CONDITION_OPERATOR = {
  IS: 'IS',
  IS_NOT: 'IS_NOT',
  CONTAINS: 'CONTAINS',
  DOES_NOT_CONTAIN: 'DOES_NOT_CONTAIN',
  STARTS_WITH: 'STARTS_WITH',
  ENDS_WITH: 'ENDS_WITH',
  IS_ONE_OF: 'IS_ONE_OF',
  IS_NOT_ONE_OF: 'IS_NOT_ONE_OF',
  CONTAINS_ANY_OF: 'CONTAINS_ANY_OF',
  CONTAINS_ALL_OF: 'CONTAINS_ALL_OF',
  INCLUDES: 'INCLUDES',
  DOES_NOT_INCLUDE: 'DOES_NOT_INCLUDE',
  IS_BEFORE: 'IS_BEFORE',
  IS_AFTER: 'IS_AFTER',
  IS_TODAY: 'IS_TODAY',
  IS_OVERDUE: 'IS_OVERDUE',
  IS_WITHIN_NEXT: 'IS_WITHIN_NEXT',
  EQUALS: 'EQUALS',
  DOES_NOT_EQUAL: 'DOES_NOT_EQUAL',
  GREATER_THAN: 'GREATER_THAN',
  GREATER_THAN_OR_EQUAL: 'GREATER_THAN_OR_EQUAL',
  LESS_THAN: 'LESS_THAN',
  LESS_THAN_OR_EQUAL: 'LESS_THAN_OR_EQUAL',
  BETWEEN: 'BETWEEN',
  IS_EMPTY: 'IS_EMPTY',
  IS_NOT_EMPTY: 'IS_NOT_EMPTY',
  IS_CHECKED: 'IS_CHECKED',
  IS_NOT_CHECKED: 'IS_NOT_CHECKED',
} as const;
export type ConditionOperator = (typeof CONDITION_OPERATOR)[keyof typeof CONDITION_OPERATOR];
export const CONDITION_OPERATOR_VALUES: readonly ConditionOperator[] =
  Object.values(CONDITION_OPERATOR);

/**
 * How each operator reads in the inspector.
 *
 * Lower case and unpunctuated because these are rendered between a field name
 * and a value — "Due date is before 12 May" is one sentence, and a capitalised
 * fragment in the middle of it reads as a heading.
 */
export const CONDITION_OPERATOR_LABEL: Record<ConditionOperator, string> = {
  IS: 'is',
  IS_NOT: 'is not',
  CONTAINS: 'contains',
  DOES_NOT_CONTAIN: 'does not contain',
  STARTS_WITH: 'starts with',
  ENDS_WITH: 'ends with',
  IS_ONE_OF: 'is one of',
  IS_NOT_ONE_OF: 'is not one of',
  CONTAINS_ANY_OF: 'contains any of',
  CONTAINS_ALL_OF: 'contains all of',
  INCLUDES: 'includes',
  DOES_NOT_INCLUDE: 'does not include',
  IS_BEFORE: 'is before',
  IS_AFTER: 'is after',
  IS_TODAY: 'is today',
  IS_OVERDUE: 'is overdue',
  IS_WITHIN_NEXT: 'is within the next',
  EQUALS: 'equals',
  DOES_NOT_EQUAL: 'does not equal',
  GREATER_THAN: 'greater than',
  GREATER_THAN_OR_EQUAL: 'greater than or equal',
  LESS_THAN: 'less than',
  LESS_THAN_OR_EQUAL: 'less than or equal',
  BETWEEN: 'between',
  IS_EMPTY: 'is empty',
  IS_NOT_EMPTY: 'is not empty',
  IS_CHECKED: 'is checked',
  IS_NOT_CHECKED: 'is not checked',
};

/**
 * Which operators each kind of value may be compared with.
 *
 * Ordering matters: the inspector renders these in order and the first is the
 * default, so the commonest comparison for each type comes first.
 *
 * Shared rather than kept in the builder because the API validates the same
 * combinations — a condition the form would not let you build must also be one
 * the endpoint refuses, since a form is not a check.
 */
export const OPERATORS_BY_VALUE_TYPE: Record<ConditionValueType, readonly ConditionOperator[]> = {
  TEXT: [
    CONDITION_OPERATOR.IS,
    CONDITION_OPERATOR.IS_NOT,
    CONDITION_OPERATOR.CONTAINS,
    CONDITION_OPERATOR.DOES_NOT_CONTAIN,
    CONDITION_OPERATOR.STARTS_WITH,
    CONDITION_OPERATOR.ENDS_WITH,
    CONDITION_OPERATOR.IS_EMPTY,
    CONDITION_OPERATOR.IS_NOT_EMPTY,
  ],
  SINGLE_SELECT: [
    CONDITION_OPERATOR.IS,
    CONDITION_OPERATOR.IS_NOT,
    CONDITION_OPERATOR.IS_ONE_OF,
    CONDITION_OPERATOR.IS_NOT_ONE_OF,
    CONDITION_OPERATOR.IS_EMPTY,
    CONDITION_OPERATOR.IS_NOT_EMPTY,
  ],
  MULTI_SELECT: [
    CONDITION_OPERATOR.CONTAINS,
    CONDITION_OPERATOR.DOES_NOT_CONTAIN,
    CONDITION_OPERATOR.CONTAINS_ANY_OF,
    CONDITION_OPERATOR.CONTAINS_ALL_OF,
    CONDITION_OPERATOR.IS_EMPTY,
    CONDITION_OPERATOR.IS_NOT_EMPTY,
  ],
  PEOPLE: [
    CONDITION_OPERATOR.IS,
    CONDITION_OPERATOR.IS_NOT,
    CONDITION_OPERATOR.IS_ONE_OF,
    CONDITION_OPERATOR.INCLUDES,
    CONDITION_OPERATOR.DOES_NOT_INCLUDE,
    CONDITION_OPERATOR.IS_EMPTY,
    CONDITION_OPERATOR.IS_NOT_EMPTY,
  ],
  DATE: [
    CONDITION_OPERATOR.IS,
    CONDITION_OPERATOR.IS_NOT,
    CONDITION_OPERATOR.IS_BEFORE,
    CONDITION_OPERATOR.IS_AFTER,
    CONDITION_OPERATOR.IS_TODAY,
    CONDITION_OPERATOR.IS_OVERDUE,
    CONDITION_OPERATOR.IS_WITHIN_NEXT,
    CONDITION_OPERATOR.IS_EMPTY,
    CONDITION_OPERATOR.IS_NOT_EMPTY,
  ],
  NUMBER: [
    CONDITION_OPERATOR.EQUALS,
    CONDITION_OPERATOR.DOES_NOT_EQUAL,
    CONDITION_OPERATOR.GREATER_THAN,
    CONDITION_OPERATOR.GREATER_THAN_OR_EQUAL,
    CONDITION_OPERATOR.LESS_THAN,
    CONDITION_OPERATOR.LESS_THAN_OR_EQUAL,
    CONDITION_OPERATOR.BETWEEN,
    CONDITION_OPERATOR.IS_EMPTY,
    CONDITION_OPERATOR.IS_NOT_EMPTY,
  ],
  CHECKBOX: [CONDITION_OPERATOR.IS_CHECKED, CONDITION_OPERATOR.IS_NOT_CHECKED],
};

/**
 * Operators that carry their whole question in the operator.
 *
 * "Is empty" with a value box beside it invites somebody to fill the box and
 * then wonder why it was ignored; "is overdue" and "is today" are the same —
 * the comparison date is now, not something to choose.
 */
export const VALUELESS_CONDITION_OPERATORS: readonly ConditionOperator[] = [
  CONDITION_OPERATOR.IS_EMPTY,
  CONDITION_OPERATOR.IS_NOT_EMPTY,
  CONDITION_OPERATOR.IS_TODAY,
  CONDITION_OPERATOR.IS_OVERDUE,
  CONDITION_OPERATOR.IS_CHECKED,
  CONDITION_OPERATOR.IS_NOT_CHECKED,
];

/**
 * Operators whose value is a list rather than a scalar.
 *
 * `BETWEEN` belongs here even though it is not a "one of" form: its value is
 * two numbers, and a control expecting one would silently drop the second.
 */
export const MULTI_VALUE_CONDITION_OPERATORS: readonly ConditionOperator[] = [
  CONDITION_OPERATOR.IS_ONE_OF,
  CONDITION_OPERATOR.IS_NOT_ONE_OF,
  CONDITION_OPERATOR.CONTAINS_ANY_OF,
  CONDITION_OPERATOR.CONTAINS_ALL_OF,
  CONDITION_OPERATOR.BETWEEN,
];

/** Whether the inspector shows a value control beside this operator. */
export function operatorNeedsValue(operator: ConditionOperator): boolean {
  return !VALUELESS_CONDITION_OPERATORS.includes(operator);
}

/** Whether that value control accepts several values. */
export function operatorTakesMultipleValues(operator: ConditionOperator): boolean {
  return MULTI_VALUE_CONDITION_OPERATORS.includes(operator);
}

/* -------------------------------------------------------------------------- */
/* Trigger configuration forms                                                 */
/* -------------------------------------------------------------------------- */

/**
 * How a trigger is narrowed, chosen after the trigger itself.
 *
 * Deliberately *not* new members of `AutomationTrigger`. The runner matches an
 * event against `triggerType` with an indexed query, and splitting one event
 * into four types would mean four rows to match instead of one and a migration
 * of every existing rule. These are shapes of the trigger's configuration, so
 * the event that fires the rule stays `TASK_MOVED_TO_SECTION` whichever form
 * somebody picked.
 */
export const TRIGGER_CONFIG_FORM = {
  /** Any move, wherever it lands. */
  SECTION_CHANGED: 'SECTION_CHANGED',
  /** Moved into one particular section. */
  SECTION_CHANGED_TO: 'SECTION_CHANGED_TO',
  /**
   * Moved anywhere other than one particular section.
   *
   * Named for the destination, not the source. "From" would read as "moved out
   * of X", which is a different rule: a task going B → C would fire it, and the
   * brief is explicit that this tests where the task *ended up*.
   */
  SECTION_CHANGED_TO_NOT: 'SECTION_CHANGED_TO_NOT',
  /** Moved into any of several sections. */
  SECTION_CHANGED_TO_ANY_OF: 'SECTION_CHANGED_TO_ANY_OF',
} as const;
export type TriggerConfigForm = (typeof TRIGGER_CONFIG_FORM)[keyof typeof TRIGGER_CONFIG_FORM];
export const TRIGGER_CONFIG_FORM_VALUES: readonly TriggerConfigForm[] =
  Object.values(TRIGGER_CONFIG_FORM);

/**
 * The wording from the trigger inspector, which is not a restatement of the key.
 *
 * The key says what the rule does with the configuration; the label is the
 * phrase somebody picks from a list where the field name is already the
 * heading. Keeping them apart is what allows the wording to be improved without
 * rewriting stored rules.
 */
export const TRIGGER_CONFIG_FORM_LABEL: Record<TriggerConfigForm, string> = {
  SECTION_CHANGED: 'Section is changed',
  SECTION_CHANGED_TO: 'Section is…',
  SECTION_CHANGED_TO_NOT: 'Section is not…',
  SECTION_CHANGED_TO_ANY_OF: 'Section is one of…',
};

/**
 * Which forms each trigger offers.
 *
 * Partial on purpose: most triggers need no narrowing beyond the event itself,
 * and an empty array for each of them would be a list to keep in step with the
 * trigger enum for no gain. A trigger absent from this map has no forms.
 */
export const TRIGGER_CONFIG_FORMS_BY_TRIGGER: Partial<
  Record<AutomationTrigger, readonly TriggerConfigForm[]>
> = {
  [AutomationTrigger.TASK_MOVED_TO_SECTION]: [
    TRIGGER_CONFIG_FORM.SECTION_CHANGED,
    TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO,
    TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_NOT,
    TRIGGER_CONFIG_FORM.SECTION_CHANGED_TO_ANY_OF,
  ],
};

/**
 * The form that needs no section chosen.
 *
 * Named so the inspector and the validator agree on when the second field
 * appears, rather than each carrying its own list of the three that do.
 */
export const TRIGGER_CONFIG_FORMS_WITHOUT_VALUE: readonly TriggerConfigForm[] = [
  TRIGGER_CONFIG_FORM.SECTION_CHANGED,
];
