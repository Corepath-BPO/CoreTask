import type { Task, UpdateTaskPayload, UserRef } from '@coretask/types';

/** One column of the grid: a week, or one of the piles either side of them. */
export interface WorkloadColumn {
  key: string;
  label: string;
  /** For a week: its Monday, as a UTC day in milliseconds. */
  start?: number;
}

export interface WorkloadPersonRow {
  /** Null for the work nobody is assigned. */
  person: Pick<UserRef, 'id' | 'name' | 'avatarUrl'> | null;
  cells: Record<string, Task[]>;
  open: number;
  estimatedMinutes: number;
}

export interface WeeklyWorkload {
  columns: WorkloadColumn[];
  rows: WorkloadPersonRow[];
}

const DAY_MS = 86_400_000;

/** The calendar day a date-only column names, as UTC midnight milliseconds. */
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Monday of the week holding `day` (a UTC day in milliseconds). */
export function mondayOf(day: number): number {
  const weekday = (new Date(day).getUTCDay() + 6) % 7;
  return day - weekday * DAY_MS;
}

const SHORT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Open work by person and by the week it is due — Asana's project Workload,
 * as a grid. Before the weeks, what is already overdue; after them, what is
 * due later; and a column for work with no due date at all, which is load
 * nobody has scheduled. People carrying the most come first; the
 * unassigned pile last.
 */
export function weeklyWorkload(tasks: readonly Task[], now: Date, weeks = 6): WeeklyWorkload {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const firstMonday = mondayOf(today);

  const columns: WorkloadColumn[] = [{ key: 'overdue', label: 'Overdue' }];
  for (let index = 0; index < weeks; index += 1) {
    const start = firstMonday + index * 7 * DAY_MS;
    columns.push({
      key: `w${index}`,
      label: index === 0 ? 'This week' : `Week of ${SHORT.format(start)}`,
      start,
    });
  }
  columns.push({ key: 'later', label: 'Later' }, { key: 'none', label: 'No due date' });
  const lastWeekEnd = firstMonday + weeks * 7 * DAY_MS;

  const columnFor = (task: Task): string => {
    if (!task.dueDate) return 'none';
    const due = dayOf(task.dueDate);
    if (due < today) return 'overdue';
    if (due >= lastWeekEnd) return 'later';
    return `w${Math.floor((due - firstMonday) / (7 * DAY_MS))}`;
  };

  const rows = new Map<string, WorkloadPersonRow>();
  for (const task of tasks) {
    if (task.completedAt !== null || task.archivedAt !== null) continue;
    const key = task.assigneeId ?? '';
    const row =
      rows.get(key) ??
      ({
        person: task.assignee
          ? { id: task.assignee.id, name: task.assignee.name, avatarUrl: task.assignee.avatarUrl }
          : null,
        cells: {},
        open: 0,
        estimatedMinutes: 0,
      } satisfies WorkloadPersonRow);
    const column = columnFor(task);
    (row.cells[column] ??= []).push(task);
    row.open += 1;
    row.estimatedMinutes += task.estimatedMinutes ?? 0;
    rows.set(key, row);
  }

  return {
    columns,
    rows: [...rows.values()].sort((a, b) => {
      if ((a.person === null) !== (b.person === null)) return a.person === null ? 1 : -1;
      return b.open - a.open || (a.person?.name ?? '').localeCompare(b.person?.name ?? '');
    }),
  };
}

/** A cell's load: how many tasks, or the hours their estimates add up to. */
export function cellLoad(tasks: readonly Task[] | undefined, measure: 'tasks' | 'hours'): number {
  if (!tasks || tasks.length === 0) return 0;
  if (measure === 'tasks') return tasks.length;
  const minutes = tasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);
  return Math.round((minutes / 60) * 10) / 10;
}

/** A cell a task can be dropped on: the row's person, and the column. */
export interface WorkloadTarget {
  /** Null for the unassigned row. */
  personId: string | null;
  column: WorkloadColumn;
}

/**
 * Whether a column takes a dropped task. A week or "No due date" sets the due
 * date; "Overdue" and "Later" are piles, not dates, so they only take a task
 * that is already in them — to hand it to someone else.
 */
export function acceptsDrop(column: WorkloadColumn, from: string): boolean {
  return column.start !== undefined || column.key === 'none' || column.key === from;
}

const isoDay = (day: number) => new Date(day).toISOString().slice(0, 10);

/**
 * What dropping a task on a cell changes — Asana's Workload drag. The row
 * gives the assignee. A week gives the due date: the same weekday in that
 * week, or Friday for a task that had no date, and never a day already past.
 * Its start date and times move by the same number of days, so it keeps its
 * length. "No due date" clears the date. Null when nothing would change.
 */
export function workloadMove(
  task: Task,
  from: string,
  target: WorkloadTarget,
  now: Date,
): UpdateTaskPayload | null {
  if (!acceptsDrop(target.column, from)) return null;
  const payload: UpdateTaskPayload = {};
  if ((task.assigneeId ?? null) !== target.personId) payload.assigneeId = target.personId;

  if (target.column.key !== from) {
    if (target.column.key === 'none') {
      payload.dueDate = null;
      payload.dueAt = null;
    } else if (target.column.start !== undefined) {
      const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      const previous = task.dueDate ? dayOf(task.dueDate) : null;
      // Monday is 0; Friday, 4.
      const weekday = previous === null ? 4 : (new Date(previous).getUTCDay() + 6) % 7;
      const due = Math.max(today, target.column.start + weekday * DAY_MS);
      payload.dueDate = isoDay(due);
      if (previous !== null) {
        const shift = due - previous;
        if (task.dueAt) payload.dueAt = new Date(Date.parse(task.dueAt) + shift).toISOString();
        if (task.startDate) payload.startDate = isoDay(dayOf(task.startDate) + shift);
        if (task.startAt)
          payload.startAt = new Date(Date.parse(task.startAt) + shift).toISOString();
      } else if (task.startDate && dayOf(task.startDate) > due) {
        // A start after the new due date would be a task that ends before it begins.
        payload.startDate = payload.dueDate;
        payload.startAt = null;
      }
    }
  }
  return Object.keys(payload).length > 0 ? payload : null;
}
