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
export type AutomationRuleStatus = (typeof AutomationRuleStatus)[keyof typeof AutomationRuleStatus];
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
  // One per field somebody can watch on its own, raised beside TASK_UPDATED
  // by every path that writes the field — a person's edit or a rule's.
  TASK_DUE_DATE_CHANGED: 'TASK_DUE_DATE_CHANGED',
  TASK_START_DATE_CHANGED: 'TASK_START_DATE_CHANGED',
  TASK_ESTIMATE_CHANGED: 'TASK_ESTIMATE_CHANGED',
  TASK_TITLE_CHANGED: 'TASK_TITLE_CHANGED',
  TASK_DESCRIPTION_CHANGED: 'TASK_DESCRIPTION_CHANGED',
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
  TASK_DUE_DATE_CHANGED: 'When a task’s due date changes',
  TASK_START_DATE_CHANGED: 'When a task’s start date changes',
  TASK_ESTIMATE_CHANGED: 'When a task’s estimate changes',
  TASK_TITLE_CHANGED: 'When a task’s name changes',
  TASK_DESCRIPTION_CHANGED: 'When a task’s description changes',
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
  MOVE_TO_PROJECT: 'MOVE_TO_PROJECT',
  UPDATE_STATUS: 'UPDATE_STATUS',
  UPDATE_PRIORITY: 'UPDATE_PRIORITY',
  SET_DUE_DATE: 'SET_DUE_DATE',
  CLEAR_DUE_DATE: 'CLEAR_DUE_DATE',
  SET_START_DATE: 'SET_START_DATE',
  CLEAR_START_DATE: 'CLEAR_START_DATE',
  SET_ESTIMATE: 'SET_ESTIMATE',
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
  MOVE_TO_PROJECT: 'Move to another project',
  UPDATE_STATUS: 'Change the status',
  UPDATE_PRIORITY: 'Change the priority',
  SET_DUE_DATE: 'Set the due date',
  CLEAR_DUE_DATE: 'Clear the due date',
  SET_START_DATE: 'Set the start date',
  CLEAR_START_DATE: 'Clear the start date',
  SET_ESTIMATE: 'Set the estimate',
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
  'AI_ACTION',
] as const;

// ---------------------------------------------------------------------------
// The rule library
// ---------------------------------------------------------------------------

/**
 * What a reference in a saved template points at.
 *
 * A template carries ids from the project it was saved in, and applying it
 * elsewhere matches each by name. When nothing matches, this says what kind of
 * thing is missing, so the builder can ask for "a section" rather than "a value".
 */
export const AutomationTemplateReferenceKind = {
  SECTION: 'SECTION',
  STATUS: 'STATUS',
  CUSTOM_FIELD: 'CUSTOM_FIELD',
  /** A select option, when the field matched but the option did not. */
  OPTION: 'OPTION',
} as const;
export type AutomationTemplateReferenceKind =
  (typeof AutomationTemplateReferenceKind)[keyof typeof AutomationTemplateReferenceKind];

export const AUTOMATION_TEMPLATE_REFERENCE_KIND_LABEL: Record<
  AutomationTemplateReferenceKind,
  string
> = {
  SECTION: 'a section',
  STATUS: 'a status',
  CUSTOM_FIELD: 'a field',
  OPTION: 'an option',
};

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

/** The most subtasks one CREATE_SUBTASK action creates per run. */
export const MAX_SUBTASKS_PER_ACTION = 20;

/**
 * One subtask a CREATE_SUBTASK action will create.
 *
 * A title, and optionally who it goes to and when it is due. The due date is
 * one of two shapes: a fixed calendar date, or a number of days after the rule
 * runs — "due three days after the request comes in" is what a checklist
 * usually wants, and a fixed date written into a rule is stale the week after.
 * A row holding both keeps the fixed date.
 */
export interface SubtaskEntry {
  title: string;
  /** Who it is assigned to on creation. Absent for nobody. */
  assigneeId?: string;
  /** A fixed calendar date, `YYYY-MM-DD`. Empty while somebody is still choosing one. */
  dueDate?: string;
  /** Days after the rule runs; zero is the day it runs. */
  dueInDays?: number;
}

/** Whether a value is a real calendar day written `YYYY-MM-DD`. */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  // Parsed and written back: a day that does not exist either fails to parse
  // or rolls into the next month, and neither comes back as itself.
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * One stored row, whichever shape it was stored in.
 *
 * A bare string is what every rule built before a subtask could carry an
 * assignee stored, and it still means "this title, nobody, no date". An object
 * carries the rest, each key kept only when it holds the type the runner
 * reads — a number under `assigneeId` is dropped here rather than looked up.
 * Nothing is trimmed or refused: this reads a row as it is, blank title and
 * empty date included, so the form can hold one that is still being filled in.
 */
export function subtaskEntry(raw: unknown): SubtaskEntry {
  if (typeof raw !== 'object' || raw === null) return { title: String(raw ?? '') };

  const row = raw as Record<string, unknown>;
  const entry: SubtaskEntry = { title: String(row['title'] ?? '') };

  if (typeof row['assigneeId'] === 'string' && row['assigneeId'] !== '') {
    entry.assigneeId = row['assigneeId'];
  }

  if (typeof row['dueDate'] === 'string') {
    entry.dueDate = row['dueDate'];
  } else if (typeof row['dueInDays'] === 'number') {
    entry.dueInDays = row['dueInDays'];
  }

  return entry;
}

/**
 * The subtasks a CREATE_SUBTASK action will create, in order.
 *
 * Lives here because four places need the same answer — the runner creating
 * them, the validator refusing an empty step, and the builder's card and form —
 * and a list read four slightly different ways is how a step publishes
 * complete and runs empty. Reads the `subtasks` list and the single `title`
 * the action stored before it held a list, so old rules keep running
 * unchanged. Blank rows are dropped rather than refused: the form keeps them
 * around while somebody is still typing.
 */
export function subtaskEntries(configuration: Record<string, unknown>): SubtaskEntry[] {
  const raw = Array.isArray(configuration['subtasks'])
    ? configuration['subtasks']
    : [configuration['title']];

  return raw
    .map((row) => {
      const entry = subtaskEntry(row);
      return { ...entry, title: entry.title.trim() };
    })
    .filter((entry) => entry.title !== '')
    .slice(0, MAX_SUBTASKS_PER_ACTION);
}

/** The titles alone, for the places that only count or name them. */
export function subtaskTitles(configuration: Record<string, unknown>): string[] {
  return subtaskEntries(configuration).map((entry) => entry.title);
}

/** Something wrong with a subtask row, and whether it is merely unfinished. */
export interface SubtaskProblem {
  message: string;
  /**
   * True for a row somebody has not finished filling in — a draft may hold
   * that — as opposed to one holding something the runner could never use.
   */
  incomplete: boolean;
}

/**
 * What stops the listed subtasks being created as written.
 *
 * Checked here rather than left to the runner, because a date the runner
 * cannot parse would fail the action on every run of a rule that published
 * cleanly. Each message once, however many rows share the fault: the card has
 * one line for it, and three copies of "not a real date" say no more than one.
 */
export function subtaskProblems(configuration: Record<string, unknown>): SubtaskProblem[] {
  const problems = new Map<string, SubtaskProblem>();
  const add = (message: string, incomplete: boolean) =>
    problems.set(message, { message, incomplete });

  for (const entry of subtaskEntries(configuration)) {
    if (entry.dueDate === '') {
      add('Choose a due date for each subtask that has one.', true);
    } else if (entry.dueDate !== undefined && !isCalendarDate(entry.dueDate)) {
      add('A subtask’s due date is not a real date.', false);
    }

    if (
      entry.dueInDays !== undefined &&
      !(Number.isInteger(entry.dueInDays) && entry.dueInDays >= 0)
    ) {
      add('Days after the rule runs has to be a whole number, zero or more.', false);
    }
  }

  return [...problems.values()];
}

/**
 * A rule never re-triggers on a change it made itself.
 *
 * The commonest loop by far: a rule that sets a status, listening for status
 * changes. Blocking the rule from reacting to its own writes kills that class
 * outright, and the depth limit catches the multi-rule cycles that remain.
 */
export const BLOCK_SELF_RETRIGGER = true;
