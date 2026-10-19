/**
 * My Tasks' sections — Asana's defaults, in Asana's order.
 *
 * Each is a personal bucket: where a task sits in *my* list says nothing about
 * where it sits in anyone else's, so placement is stored per person and never
 * touches the task. A task with no placement is "Recently assigned", which is
 * exactly where Asana puts newly assigned work.
 */
export const MyTasksBucket = {
  RECENTLY_ASSIGNED: 'RECENTLY_ASSIGNED',
  TODAY: 'TODAY',
  NEXT_WEEK: 'NEXT_WEEK',
  LATER: 'LATER',
} as const;
export type MyTasksBucket = (typeof MyTasksBucket)[keyof typeof MyTasksBucket];
export const MY_TASKS_BUCKETS = Object.values(MyTasksBucket);

export const MY_TASKS_BUCKET_LABEL: Record<MyTasksBucket, string> = {
  RECENTLY_ASSIGNED: 'Recently assigned',
  TODAY: 'Do today',
  NEXT_WEEK: 'Do next week',
  LATER: 'Do later',
};

/**
 * My Tasks' auto-sort rules — Asana's "auto-promote". Each moves a task into
 * a section when its due date says so, unless its owner moved it themselves
 * today: an explicit choice made today wins until tomorrow.
 */
export interface MyTasksRules {
  /** Due today or overdue → Do today. */
  dueToday: boolean;
  /** Due in the next seven days → Do next week, from Recently assigned or Do later. */
  dueThisWeek: boolean;
}

export const DEFAULT_MY_TASKS_RULES: MyTasksRules = { dueToday: true, dueThisWeek: false };

/** Rules as stored (a JSON column), with the defaults filling any gap. */
export function myTasksRulesOf(value: unknown): MyTasksRules {
  const stored = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  return {
    dueToday:
      typeof stored['dueToday'] === 'boolean'
        ? stored['dueToday']
        : DEFAULT_MY_TASKS_RULES.dueToday,
    dueThisWeek:
      typeof stored['dueThisWeek'] === 'boolean'
        ? stored['dueThisWeek']
        : DEFAULT_MY_TASKS_RULES.dueThisWeek,
  };
}

const plusDays = (day: string, days: number) => {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
};

/**
 * The section a task shows in: where its owner put it, unless a rule moves
 * it. `today` is the owner's calendar day (`yyyy-mm-dd`); `placedToday` says
 * whether they placed it themselves since that day began.
 */
export function myTasksBucketFor(input: {
  placed: MyTasksBucket | null;
  placedToday: boolean;
  dueDate: string | null;
  completed: boolean;
  rules: MyTasksRules;
  today: string;
}): MyTasksBucket {
  const placed = input.placed ?? MyTasksBucket.RECENTLY_ASSIGNED;
  if (input.placedToday || input.completed || !input.dueDate) return placed;
  const due = input.dueDate.slice(0, 10);
  if (input.rules.dueToday && due <= input.today) return MyTasksBucket.TODAY;
  if (
    input.rules.dueThisWeek &&
    due <= plusDays(input.today, 7) &&
    (placed === MyTasksBucket.RECENTLY_ASSIGNED || placed === MyTasksBucket.LATER)
  ) {
    return MyTasksBucket.NEXT_WEEK;
  }
  return placed;
}
