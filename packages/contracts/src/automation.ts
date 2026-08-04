/**
 * The automation vocabulary, shared so the builder can only offer combinations
 * the engine implements.
 *
 * Everything listed here is executable. Actions the engine cannot yet perform
 * live in `PLANNED_ACTIONS` and are never offered as working controls — a
 * button that appears to work and silently does nothing is worse than one that
 * is not there.
 */

export const AutomationRuleStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  DISABLED: 'DISABLED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type AutomationRuleStatus =
  (typeof AutomationRuleStatus)[keyof typeof AutomationRuleStatus];
export const AUTOMATION_RULE_STATUSES = Object.values(AutomationRuleStatus);

export const AutomationNodeType = {
  TRIGGER: 'TRIGGER',
  CONDITION: 'CONDITION',
  ACTION: 'ACTION',
  BRANCH: 'BRANCH',
  DELAY: 'DELAY',
} as const;
export type AutomationNodeType = (typeof AutomationNodeType)[keyof typeof AutomationNodeType];
export const AUTOMATION_NODE_TYPES = Object.values(AutomationNodeType);

export const AutomationExecutionStatus = {
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  PARTIALLY_FAILED: 'PARTIALLY_FAILED',
  SKIPPED: 'SKIPPED',
} as const;
export type AutomationExecutionStatus =
  (typeof AutomationExecutionStatus)[keyof typeof AutomationExecutionStatus];
export const AUTOMATION_EXECUTION_STATUSES = Object.values(AutomationExecutionStatus);

/** Domain events a rule can listen for. */
export const AutomationTrigger = {
  TASK_CREATED: 'TASK_CREATED',
  TASK_UPDATED: 'TASK_UPDATED',
  TASK_MOVED_TO_SECTION: 'TASK_MOVED_TO_SECTION',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  TASK_PRIORITY_CHANGED: 'TASK_PRIORITY_CHANGED',
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_COMPLETED: 'TASK_COMPLETED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  CUSTOM_FIELD_CHANGED: 'CUSTOM_FIELD_CHANGED',
  TICKET_CREATED: 'TICKET_CREATED',
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
} as const;
export type AutomationTrigger = (typeof AutomationTrigger)[keyof typeof AutomationTrigger];
export const AUTOMATION_TRIGGERS = Object.values(AutomationTrigger);

/** Human labels, so the builder and the rule list read the same. */
export const TRIGGER_LABEL: Record<AutomationTrigger, string> = {
  TASK_CREATED: 'When a task is created',
  TASK_UPDATED: 'When a task is updated',
  TASK_MOVED_TO_SECTION: 'When a task is moved to a section',
  TASK_STATUS_CHANGED: 'When a task’s status changes',
  TASK_PRIORITY_CHANGED: 'When a task’s priority changes',
  TASK_ASSIGNED: 'When a task is assigned',
  TASK_COMPLETED: 'When a task is completed',
  COMMENT_ADDED: 'When a comment is added',
  CUSTOM_FIELD_CHANGED: 'When a custom field changes',
  TICKET_CREATED: 'When a ticket is reported',
  TICKET_STATUS_CHANGED: 'When a ticket’s status changes',
};

/** Actions the engine performs today. */
export const AutomationAction = {
  ASSIGN_USER: 'ASSIGN_USER',
  UNASSIGN_USER: 'UNASSIGN_USER',
  MOVE_TO_SECTION: 'MOVE_TO_SECTION',
  UPDATE_STATUS: 'UPDATE_STATUS',
  UPDATE_PRIORITY: 'UPDATE_PRIORITY',
  SET_DUE_DATE: 'SET_DUE_DATE',
  CLEAR_DUE_DATE: 'CLEAR_DUE_DATE',
  SET_CUSTOM_FIELD: 'SET_CUSTOM_FIELD',
  ADD_COMMENT: 'ADD_COMMENT',
  SEND_IN_APP_NOTIFICATION: 'SEND_IN_APP_NOTIFICATION',
  CREATE_SUBTASK: 'CREATE_SUBTASK',
} as const;
export type AutomationAction = (typeof AutomationAction)[keyof typeof AutomationAction];
export const AUTOMATION_ACTIONS = Object.values(AutomationAction);

export const ACTION_LABEL: Record<AutomationAction, string> = {
  ASSIGN_USER: 'Assign a person',
  UNASSIGN_USER: 'Remove the assignee',
  MOVE_TO_SECTION: 'Move to a section',
  UPDATE_STATUS: 'Change the status',
  UPDATE_PRIORITY: 'Change the priority',
  SET_DUE_DATE: 'Set the due date',
  CLEAR_DUE_DATE: 'Clear the due date',
  SET_CUSTOM_FIELD: 'Set a custom field',
  ADD_COMMENT: 'Add a comment',
  SEND_IN_APP_NOTIFICATION: 'Send a notification',
  CREATE_SUBTASK: 'Create a subtask',
};

/**
 * Actions with a contract but no implementation.
 *
 * Named here so the builder can grey them out honestly rather than omitting
 * them and leaving someone to wonder, and so adding one later is a change in
 * one place.
 */
export const PLANNED_ACTIONS = [
  'SEND_EMAIL',
  'SEND_WEBHOOK',
  'DELAY',
  'CREATE_CHECKLIST',
  'ASSIGN_TEAM',
  'MOVE_PROJECT',
  'AI_ACTION',
] as const;

// ---------------------------------------------------------------------------
// Loop protection
// ---------------------------------------------------------------------------

/**
 * How many rules deep a chain may go before it is stopped.
 *
 * Rules legitimately cascade — one moves a task, another reacts to the move —
 * so a depth of one would break real workflows. Beyond a handful it is almost
 * always a cycle, and the cost of being wrong is an infinite loop chewing the
 * queue.
 */
export const MAX_AUTOMATION_DEPTH = 5;

/** How many actions one execution may perform. */
export const MAX_ACTIONS_PER_EXECUTION = 25;

/**
 * A rule never re-triggers on a change it made itself.
 *
 * The commonest loop by far: a rule that sets a status, listening for status
 * changes. Blocking the rule from reacting to its own writes kills that class
 * outright, and the depth limit catches the multi-rule cycles that remain.
 */
export const BLOCK_SELF_RETRIGGER = true;
