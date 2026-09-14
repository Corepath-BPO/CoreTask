import { AutomationTrigger } from '@coretask/contracts';

/**
 * The per-field triggers a task change raises, shared by everything that
 * writes a task.
 *
 * Three paths write one: `TasksService.update` for the task endpoints,
 * `ProjectWorkItemService.update` for the list and board, and the runner's
 * `updateTask` for a rule's own action. Each already derived the older
 * triggers — status, priority, assignee, completion — with its own copy of the
 * same conditions, and a fourth copy for five more fields is how one of them
 * ends up raising "due date changed" and another does not. So the mapping is
 * written once, keyed by the column names every path already knows.
 */

/** The trigger each watched column raises when it changes. */
export const FIELD_CHANGE_TRIGGER: Readonly<Record<string, AutomationTrigger>> = {
  // A changed time counts as a changed date: "due date changed" is what a
  // rule watching the deadline means, whether the day or the hour moved.
  dueDate: AutomationTrigger.TASK_DUE_DATE_CHANGED,
  dueAt: AutomationTrigger.TASK_DUE_DATE_CHANGED,
  startDate: AutomationTrigger.TASK_START_DATE_CHANGED,
  startAt: AutomationTrigger.TASK_START_DATE_CHANGED,
  estimatedMinutes: AutomationTrigger.TASK_ESTIMATE_CHANGED,
  title: AutomationTrigger.TASK_TITLE_CHANGED,
  description: AutomationTrigger.TASK_DESCRIPTION_CHANGED,
};

/** The triggers these changed column names amount to, each once. */
export function fieldChangeTriggers(changed: Iterable<string>): AutomationTrigger[] {
  const triggers: AutomationTrigger[] = [];

  for (const column of changed) {
    const trigger = FIELD_CHANGE_TRIGGER[column];
    if (trigger && !triggers.includes(trigger)) triggers.push(trigger);
  }

  return triggers;
}

/** The columns a change is read from — the task row's own names and types. */
export interface WatchedTaskFields {
  title: string;
  description: string | null;
  dueDate: Date | null;
  dueAt: Date | null;
  startDate: Date | null;
  startAt: Date | null;
  estimatedMinutes: number | null;
}

/**
 * Which watched columns differ between two readings of a task.
 *
 * Dates compared as instants rather than by reference, so re-saving the same
 * day is not a change; a date and its time are folded into the date's name,
 * as `FIELD_CHANGE_TRIGGER` folds their triggers.
 */
export function changedTaskFields(before: WatchedTaskFields, after: WatchedTaskFields): string[] {
  const changed: string[] = [];

  if (before.title !== after.title) changed.push('title');
  if ((before.description ?? null) !== (after.description ?? null)) changed.push('description');
  if (!sameInstant(before.dueDate, after.dueDate) || !sameInstant(before.dueAt, after.dueAt)) {
    changed.push('dueDate');
  }
  if (
    !sameInstant(before.startDate, after.startDate) ||
    !sameInstant(before.startAt, after.startAt)
  ) {
    changed.push('startDate');
  }
  if (before.estimatedMinutes !== after.estimatedMinutes) changed.push('estimatedMinutes');

  return changed;
}

/**
 * The watched fields as an event's `before` and `after` carry them.
 *
 * Dates as ISO strings, the shape every other publisher uses. The description
 * is left out: it can be long, the queue carries every event, and a condition
 * reads it off the task rather than the event.
 */
export function taskFieldSnapshot(task: WatchedTaskFields): Record<string, unknown> {
  return {
    title: task.title,
    dueDate: task.dueDate?.toISOString() ?? null,
    startDate: task.startDate?.toISOString() ?? null,
    estimatedMinutes: task.estimatedMinutes,
  };
}

function sameInstant(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}
