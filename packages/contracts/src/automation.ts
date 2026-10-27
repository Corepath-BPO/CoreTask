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
  // Started by a person from a task's menu rather than by a change.
  RUN_MANUALLY: 'RUN_MANUALLY',
  // Started by the clock. See `automation-clock.ts` for when each one fires.
  SCHEDULED_TIME: 'SCHEDULED_TIME',
  DUE_DATE_APPROACHING: 'DUE_DATE_APPROACHING',
  TASK_OVERDUE: 'TASK_OVERDUE',
  START_DATE_APPROACHING: 'START_DATE_APPROACHING',
  START_DATE_PASSED: 'START_DATE_PASSED',
  /** The last unfinished task blocking this one was finished or unlinked. */
  TASK_NO_LONGER_BLOCKED: 'TASK_NO_LONGER_BLOCKED',
  ATTACHMENT_ADDED: 'ATTACHMENT_ADDED',
  COLLABORATOR_ADDED: 'COLLABORATOR_ADDED',
  /** Converted between task, milestone and approval. */
  TASK_TYPE_CHANGED: 'TASK_TYPE_CHANGED',
  /** An approval was approved, rejected, or sent back for changes. */
  APPROVAL_STATUS_CHANGED: 'APPROVAL_STATUS_CHANGED',
  /** A custom date field (the one in `fieldId`) drawing near, or passing. */
  CUSTOM_DATE_APPROACHING: 'CUSTOM_DATE_APPROACHING',
  CUSTOM_DATE_PASSED: 'CUSTOM_DATE_PASSED',
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
  RUN_MANUALLY: 'When the rule is run manually',
  SCHEDULED_TIME: 'At a scheduled time',
  DUE_DATE_APPROACHING: 'When a task’s due date is approaching',
  TASK_OVERDUE: 'When a task becomes overdue',
  START_DATE_APPROACHING: 'When a task’s start date is approaching',
  START_DATE_PASSED: 'When a task’s start date arrives',
  TASK_NO_LONGER_BLOCKED: 'When a task is no longer blocked',
  ATTACHMENT_ADDED: 'When an attachment is added',
  COLLABORATOR_ADDED: 'When a collaborator is added',
  TASK_TYPE_CHANGED: 'When a task’s type changes',
  APPROVAL_STATUS_CHANGED: 'When an approval is decided',
  CUSTOM_DATE_APPROACHING: 'When a date field is approaching',
  CUSTOM_DATE_PASSED: 'When a date field’s date has passed',
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
  /** POSTs the task to a webhook endpoint from Settings, or to an ad-hoc URL. */
  SEND_WEBHOOK: 'SEND_WEBHOOK',
  /** Complete or reopen, through the project's own Done and To do statuses. */
  SET_COMPLETION: 'SET_COMPLETION',
  /** Detaches the task from the project; it stays in My Tasks and search. */
  REMOVE_FROM_PROJECT: 'REMOVE_FROM_PROJECT',
  /** A new task in this project, beside the one the rule acted on. */
  CREATE_TASK: 'CREATE_TASK',
  ADD_REMOVE_COLLABORATORS: 'ADD_REMOVE_COLLABORATORS',
  /** Text with variables — see `renderAutomationText`. */
  SET_TASK_NAME: 'SET_TASK_NAME',
  SET_TASK_DESCRIPTION: 'SET_TASK_DESCRIPTION',
  /** Convert to a task, a milestone or an approval. */
  SET_TASK_TYPE: 'SET_TASK_TYPE',
  /** E-mails people on the task — never an address typed into the rule. */
  SEND_EMAIL: 'SEND_EMAIL',
  /** A ticket rule's own: its status and priority are a ticket's, not a project's. */
  SET_TICKET_STATUS: 'SET_TICKET_STATUS',
  SET_TICKET_PRIORITY: 'SET_TICKET_PRIORITY',
  /** "Use AI…": a model makes the changes the step allows — see automation-ai.ts. */
  AI_ACTION: 'AI_ACTION',
  /**
   * "Draft an update with AI…": a status update for the project, written by a
   * model and left as a draft for a person to review and post. Never posted
   * by the rule. Runs in a rule with no tasks too — "every Friday, draft".
   */
  AI_DRAFT_UPDATE: 'AI_DRAFT_UPDATE',
  /** A named checklist of items to tick off, added to the task. */
  CREATE_CHECKLIST: 'CREATE_CHECKLIST',
  /** Makes a team of the workspace responsible for the task, or clears it. */
  ASSIGN_TEAM: 'ASSIGN_TEAM',
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
  SEND_WEBHOOK: 'Send a webhook',
  SET_COMPLETION: 'Change completion status',
  REMOVE_FROM_PROJECT: 'Remove from the project',
  CREATE_TASK: 'Create a task',
  ADD_REMOVE_COLLABORATORS: 'Add or remove collaborators',
  SET_TASK_NAME: 'Set the task name',
  SET_TASK_DESCRIPTION: 'Set the task description',
  SET_TASK_TYPE: 'Set the task type',
  SEND_EMAIL: 'Send an email',
  SET_TICKET_STATUS: 'Set the ticket status',
  SET_TICKET_PRIORITY: 'Set the ticket priority',
  AI_ACTION: 'Use AI',
  AI_DRAFT_UPDATE: 'Draft an update with AI',
  CREATE_CHECKLIST: 'Add a checklist',
  ASSIGN_TEAM: 'Assign a team',
};

/**
 * The catalogue group for actions that leave CoreTask. Named here because the
 * API groups by it and the builder shows that group on its own tab, so both
 * sides have to agree on the words.
 */
export const EXTERNAL_ACTION_CATEGORY = 'Send to another tool';

/**
 * Who a "Send an email" action writes to: people on the task, each a member
 * of the workspace. Not a typed address — a rule anyone can edit must not be
 * a way to send mail to anyone at all.
 */
export const AutomationEmailRecipient = {
  ASSIGNEE: 'ASSIGNEE',
  COLLABORATORS: 'COLLABORATORS',
  CREATOR: 'CREATOR',
} as const;
export type AutomationEmailRecipient =
  (typeof AutomationEmailRecipient)[keyof typeof AutomationEmailRecipient];

export const AUTOMATION_EMAIL_RECIPIENT_LABEL: Record<AutomationEmailRecipient, string> = {
  ASSIGNEE: 'The assignee',
  COLLABORATORS: 'Collaborators',
  CREATOR: 'Whoever created the task',
};

/** Most people one email step writes to, so a busy task is not a mailing list. */
export const MAX_EMAIL_RECIPIENTS = 20;
export const AUTOMATION_EMAIL_SUBJECT_MAX = 200;

/** The recipients a step's configuration names, known ones only, each once. */
export function emailRecipientsOf(
  configuration: Record<string, unknown>,
): AutomationEmailRecipient[] {
  const raw = configuration['recipients'];
  if (!Array.isArray(raw)) return [];
  const known = Object.values(AutomationEmailRecipient) as string[];
  return [
    ...new Set(
      raw.filter((value): value is AutomationEmailRecipient => known.includes(value as string)),
    ),
  ];
}

/**
 * Actions with a contract but no implementation.
 *
 * Named here so the builder can grey them out honestly rather than omitting
 * them and leaving someone to wonder, and so adding one later is a change in
 * one place. Empty since checklists and teams were built.
 */
export const PLANNED_ACTIONS: readonly string[] = [];

// ---------------------------------------------------------------------------
// Checklists
// ---------------------------------------------------------------------------

/** How many checklists one task holds. */
export const MAX_CHECKLISTS_PER_TASK = 20;
/** How many items one checklist holds — and one "Add a checklist" step writes. */
export const MAX_CHECKLIST_ITEMS = 50;
export const CHECKLIST_NAME_MAX = 200;
export const CHECKLIST_ITEM_MAX = 500;

/**
 * The checklist an "Add a checklist" step adds: its name, and its items in
 * order.
 *
 * Read the one way everywhere — the runner writing them, the validator
 * refusing an empty step, the builder's card — so a step cannot publish with
 * items the runner then reads as none. Blank rows are dropped rather than
 * refused (the form keeps them while somebody types), and both the rows and
 * their text are capped where the columns are.
 */
export function checklistOf(configuration: Record<string, unknown>): {
  name: string;
  items: string[];
} {
  const name = typeof configuration['name'] === 'string' ? configuration['name'].trim() : '';
  const raw = Array.isArray(configuration['items']) ? configuration['items'] : [];

  return {
    name: name.slice(0, CHECKLIST_NAME_MAX),
    items: raw
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item !== '')
      .map((item) => item.slice(0, CHECKLIST_ITEM_MAX))
      .slice(0, MAX_CHECKLIST_ITEMS),
  };
}

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

/**
 * How many actions one execution may perform.
 *
 * Publishing refuses a rule that could reach more in one go, and a run that
 * still gets here — a rule written before the check — runs the first this many
 * and logs every step after them as not run, rather than dropping them quietly.
 */
export const MAX_ACTIONS_PER_EXECUTION = 25;

/**
 * How many actions one chain of rules may perform between them.
 *
 * A chain is everything descended from one event: the rules it set off, the
 * rules their changes set off, and so on. `MAX_AUTOMATION_DEPTH` bounds how
 * deep that goes and `MAX_ACTIONS_PER_EXECUTION` how much one run does, and
 * neither bounds the total — five hops of twenty-five actions each is 125
 * writes from one click, within both. This does. Steps past it are logged as
 * not run, and a run with none left is skipped with the reason.
 */
export const MAX_ACTIONS_PER_CHAIN = 100;

/** The most subtasks one CREATE_SUBTASK action creates per run. */
export const MAX_SUBTASKS_PER_ACTION = 20;

/**
 * One subtask a CREATE_SUBTASK action will create.
 *
 * A title, and optionally who it goes to and when it is due. The due date is
 * one of three shapes: a fixed calendar date, a number of days after the rule
 * runs — "due three days after the request comes in" is what a checklist
 * usually wants, and a fixed date written into a rule is stale the week after —
 * or a weekday of next week, for a team that plans its week ahead ("send the
 * owner update on Tuesday next week"). A row holding more than one keeps the
 * first of those.
 */
export interface SubtaskEntry {
  title: string;
  /** Who it is assigned to on creation. Absent for nobody. */
  assigneeId?: string;
  /** A fixed calendar date, `YYYY-MM-DD`. Empty while somebody is still choosing one. */
  dueDate?: string;
  /** Days after the rule runs; zero is the day it runs. */
  dueInDays?: number;
  /** That weekday of the week after the rule runs, 0 Sunday to 6 Saturday — see `dayNextWeek`. */
  dueWeekdayNextWeek?: number;
}

/** Whether a value is a weekday as `Date#getUTCDay` counts them: 0 Sunday to 6 Saturday. */
export function isWeekday(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6;
}

/**
 * That weekday of the week after the one `at` falls in, weeks starting on
 * Sunday, counted in UTC as every date a rule writes is.
 *
 * Always the following week, even when the day is still to come in this one:
 * on a Monday, "Wednesday next week" is nine days off, not two. That is what
 * the Asana teams' n8n workflows did for every subtask a rule made, and what
 * "next week" means in a weekly plan.
 */
export function dayNextWeek(at: Date, weekday: number): Date {
  const day = new Date(at);
  day.setUTCDate(day.getUTCDate() + weekday - day.getUTCDay() + 7);
  return day;
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
  } else if (typeof row['dueWeekdayNextWeek'] === 'number') {
    entry.dueWeekdayNextWeek = row['dueWeekdayNextWeek'];
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

/**
 * Asana's "Let AI decide the number of subtasks to create".
 *
 * The step's list stays the author's: AI reads the task and keeps the rows it
 * needs, in the list's order, with their own assignees and dates. It never
 * writes a subtask of its own — that is what a "Use AI…" step may do.
 */
export function aiDecidesSubtasks(configuration: Record<string, unknown>): boolean {
  return configuration['aiDecides'] === true;
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

    if (entry.dueWeekdayNextWeek !== undefined && !isWeekday(entry.dueWeekdayNextWeek)) {
      add('A subtask’s day next week has to be Sunday to Saturday.', false);
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
