import { AutomationNodeType } from './automation.js';
import { FilterOperator } from './query.js';

/**
 * The visual vocabulary of the rule builder.
 *
 * The *shape* of a rule is already in the database: `automation_nodes` carries
 * `nodeType`, `parentNodeId`, `branchKey` and an ordinal. This file adds only
 * what a canvas needs on top of that — how an edge is derived, what each node
 * is called, and which colour carries which meaning.
 *
 * There is deliberately no edge type in the database. `parentNodeId` already
 * says what an edge row would say, and storing both is how two answers to the
 * same question start disagreeing.
 */

/** How an edge is drawn, derived from the child node rather than stored. */
export const AutomationEdgeKind = {
  /** The ordinary next step. */
  DEFAULT: 'DEFAULT',
  /** Leaving a branch node down the arm that matched. */
  MATCH: 'MATCH',
  /** Leaving a branch node down the arm that did not. */
  ELSE: 'ELSE',
} as const;
export type AutomationEdgeKind = (typeof AutomationEdgeKind)[keyof typeof AutomationEdgeKind];

/**
 * The reserved arms of a branch.
 *
 * `branchKey` is a free string in the schema, so a future many-armed branch
 * needs no migration. These two are the ones the builder and the runner know.
 */
export const BranchKey = {
  MATCH: 'match',
  ELSE: 'else',
} as const;
export type BranchKey = (typeof BranchKey)[keyof typeof BranchKey];

/** What each node category is called in the interface. */
export const NODE_CATEGORY_LABEL: Record<AutomationNodeType, string> = {
  TRIGGER: 'When',
  CONDITION: 'Check if',
  ACTION: 'Do this',
  BRANCH: 'Split on',
  DELAY: 'Wait',
};

/**
 * Semantic accent per category.
 *
 * An accent, never a fill: a node saturated end to end stops being readable and
 * makes its own text the low-contrast part of the screen.
 */
export const NODE_ACCENT: Record<AutomationNodeType, string> = {
  TRIGGER: 'blue',
  CONDITION: 'violet',
  ACTION: 'emerald',
  BRANCH: 'cyan',
  DELAY: 'amber',
};

/**
 * A node that exists only in a draft: the "+ Do this…" the builder shows before
 * anybody has chosen an action.
 *
 * Not a database node type. A placeholder is the *absence* of a node, and
 * writing one to a published rule would give the runner a step it cannot
 * perform. The builder holds them in editor state and the API refuses them on
 * publish.
 */
export const PLACEHOLDER_NODE_TYPE = 'PLACEHOLDER';

/** Groups the trigger and action selectors present. */
export const AUTOMATION_SELECTOR_CATEGORY = {
  WORK_ITEM: 'Work item',
  ASSIGNMENT: 'Assignment',
  WORKFLOW: 'Status and workflow',
  DATES: 'Dates',
  FIELDS: 'Fields',
  COMMUNICATION: 'Communication',
  SUBTASKS: 'Subtasks',
} as const;
export type AutomationSelectorCategory =
  (typeof AUTOMATION_SELECTOR_CATEGORY)[keyof typeof AUTOMATION_SELECTOR_CATEGORY];

/**
 * What a condition can be about, and what type its value is.
 *
 * The type is what makes operators type-aware: "date contains high" and
 * "checkbox greater than 10" are combinations a form should never offer, and
 * the only way to know that is to know what the field holds.
 *
 * Lives here rather than in the builder because the API validates the same
 * combinations — a rule the form would not let you build must also be one the
 * endpoint refuses.
 */
export const ConditionValueKind = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  BOOLEAN: 'BOOLEAN',
  /** A fixed set — status, priority. */
  ENUM: 'ENUM',
  /** A row somewhere else — a section, a member. */
  REFERENCE: 'REFERENCE',
} as const;
export type ConditionValueKind = (typeof ConditionValueKind)[keyof typeof ConditionValueKind];

/** Operators each kind of value may be compared with. */
export const OPERATORS_BY_VALUE_KIND: Record<ConditionValueKind, readonly FilterOperator[]> = {
  TEXT: [
    FilterOperator.EQUALS,
    FilterOperator.NOT_EQUALS,
    FilterOperator.CONTAINS,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
  NUMBER: [
    FilterOperator.EQUALS,
    FilterOperator.NOT_EQUALS,
    FilterOperator.GREATER_THAN,
    FilterOperator.LESS_THAN,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
  DATE: [
    FilterOperator.EQUALS,
    FilterOperator.BEFORE,
    FilterOperator.AFTER,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
  BOOLEAN: [FilterOperator.EQUALS],
  ENUM: [
    FilterOperator.EQUALS,
    FilterOperator.NOT_EQUALS,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
  REFERENCE: [
    FilterOperator.EQUALS,
    FilterOperator.NOT_EQUALS,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
};

/*
 * Which operators take a value is defined once, in `query.ts`, for the view
 * filters — `VALUELESS_OPERATORS` and `operatorTakesValue`. Automation
 * conditions use the same operators and so use the same answer; a second
 * definition here would be one more place for the two to disagree.
 */

/**
 * How the builder groups several conditions.
 *
 * `ALL` is what the runner does today — every condition must hold. `ANY` needs
 * runner support before the builder offers it; see the branching document.
 */
export const ConditionMatch = {
  ALL: 'ALL',
  ANY: 'ANY',
} as const;
export type ConditionMatch = (typeof ConditionMatch)[keyof typeof ConditionMatch];

/** Severity of a validation finding. Only ERROR blocks publishing. */
export const GraphIssueLevel = {
  ERROR: 'ERROR',
  WARNING: 'WARNING',
  INFO: 'INFO',
} as const;
export type GraphIssueLevel = (typeof GraphIssueLevel)[keyof typeof GraphIssueLevel];

/** Deterministic canvas geometry, shared so server and client lay out alike. */
export const GRAPH_LAYOUT = {
  NODE_WIDTH: 380,
  NODE_HEIGHT: 96,
  /** Gap between one column of the main path and the next. */
  COLUMN_GAP: 90,
  /** Gap between a branch arm and the one above it. */
  BRANCH_GAP: 120,
  ORIGIN_X: 40,
  ORIGIN_Y: 140,
} as const;

/** Where a node sits when nothing has placed it — column index to coordinates. */
export function defaultPosition(column: number, row = 0): { x: number; y: number } {
  return {
    x: GRAPH_LAYOUT.ORIGIN_X + column * (GRAPH_LAYOUT.NODE_WIDTH + GRAPH_LAYOUT.COLUMN_GAP),
    y: GRAPH_LAYOUT.ORIGIN_Y + row * GRAPH_LAYOUT.BRANCH_GAP,
  };
}
