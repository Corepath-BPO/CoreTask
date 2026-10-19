import type { CalendarDay } from './automation-clock.js';

/**
 * Repeating tasks — Asana's "Set to repeat".
 *
 * A repeating task is one task at a time: completing it creates the next one,
 * due on the next date the pattern names. Shared because the API computes the
 * next date when a task is completed and the task pane says the same thing in
 * words before anybody completes it.
 */

export const RecurrenceFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
  YEARLY: 'YEARLY',
  /** A set number of days after the previous one was completed. */
  PERIODICALLY: 'PERIODICALLY',
} as const;
export type RecurrenceFrequency = (typeof RecurrenceFrequency)[keyof typeof RecurrenceFrequency];
export const RECURRENCE_FREQUENCIES = Object.values(RecurrenceFrequency);

export const RECURRENCE_FREQUENCY_LABEL: Record<RecurrenceFrequency, string> = {
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  YEARLY: 'Yearly',
  PERIODICALLY: 'Periodically',
};

export interface TaskRecurrence {
  frequency: RecurrenceFrequency;
  /** Every N days, weeks, months or years — or, periodically, N days after completion. */
  interval: number;
  /** 0 Sunday … 6 Saturday; read for WEEKLY. Empty means the due date's own weekday. */
  weekdays?: number[];
}

export const RECURRENCE_INTERVAL_MAX = 365;

const SHORT_WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const isWholeIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** What stops a stored recurrence being followed. Empty when it can be. */
export function recurrenceProblems(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return ['A repeat has to say how often.'];
  }
  const record = value as Record<string, unknown>;
  const problems: string[] = [];

  if (!RECURRENCE_FREQUENCIES.includes(record['frequency'] as RecurrenceFrequency)) {
    problems.push('Choose how often the task repeats.');
  }
  if (!isWholeIn(record['interval'], 1, RECURRENCE_INTERVAL_MAX)) {
    problems.push(`Repeat every 1 to ${RECURRENCE_INTERVAL_MAX}.`);
  }
  if (
    record['weekdays'] !== undefined &&
    !(Array.isArray(record['weekdays']) && record['weekdays'].every((day) => isWholeIn(day, 0, 6)))
  ) {
    problems.push('Choose days of the week from Sunday to Saturday.');
  }

  return problems;
}

/** A stored recurrence, cleaned — or null when it is not one this can follow. */
export function readRecurrence(value: unknown): TaskRecurrence | null {
  if (recurrenceProblems(value).length > 0) return null;
  const record = value as Record<string, unknown>;
  const frequency = record['frequency'] as RecurrenceFrequency;
  const weekdays = Array.isArray(record['weekdays'])
    ? [...new Set(record['weekdays'] as number[])].sort((a, b) => a - b)
    : [];

  return {
    frequency,
    interval: record['interval'] as number,
    ...(frequency === RecurrenceFrequency.WEEKLY && weekdays.length > 0 ? { weekdays } : {}),
  };
}

/** "Every 2 weeks on Mon, Wed" — the pane's line under the due date. */
export function describeRecurrence(recurrence: TaskRecurrence): string {
  const every = (unit: string) =>
    recurrence.interval === 1 ? `Every ${unit}` : `Every ${recurrence.interval} ${unit}s`;

  switch (recurrence.frequency) {
    case RecurrenceFrequency.DAILY:
      return every('day');
    case RecurrenceFrequency.WEEKLY: {
      const days = recurrence.weekdays ?? [];
      return days.length > 0
        ? `${every('week')} on ${days.map((day) => SHORT_WEEKDAY[day]).join(', ')}`
        : every('week');
    }
    case RecurrenceFrequency.MONTHLY:
      return every('month');
    case RecurrenceFrequency.YEARLY:
      return every('year');
    case RecurrenceFrequency.PERIODICALLY:
      return `${recurrence.interval} day${recurrence.interval === 1 ? '' : 's'} after completion`;
  }
}

// ---------------------------------------------------------------------------
// The next date
// ---------------------------------------------------------------------------

const toTime = (day: CalendarDay) => Date.UTC(day.year, day.month - 1, day.day);

const fromTime = (time: number): CalendarDay => {
  const date = new Date(time);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
};

const addDays = (day: CalendarDay, days: number) => fromTime(toTime(day) + days * 86_400_000);

const weekday = (day: CalendarDay) => new Date(toTime(day)).getUTCDay();

/** The same day of the month N months on, or that month's last day. */
function addMonths(day: CalendarDay, months: number, dayOfMonth: number): CalendarDay {
  const index = day.year * 12 + (day.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, day: Math.min(dayOfMonth, last) };
}

/**
 * The day the next occurrence is due.
 *
 * Counted from the previous due date — so a weekly report stays on Mondays
 * however late one was finished — but always after the day it was completed:
 * finishing three weeks late creates next week's task, not three overdue ones.
 * With no due date, the completion day stands in. "Periodically" counts from
 * the completion, which is what it means.
 */
export function nextOccurrenceDay(
  recurrence: TaskRecurrence,
  previousDue: CalendarDay | null,
  completedOn: CalendarDay,
): CalendarDay {
  const base = previousDue ?? completedOn;
  const afterCompletion = (day: CalendarDay) => toTime(day) > toTime(completedOn);
  const interval = Math.max(1, recurrence.interval);

  switch (recurrence.frequency) {
    case RecurrenceFrequency.PERIODICALLY:
      return addDays(completedOn, interval);

    case RecurrenceFrequency.DAILY: {
      let next = addDays(base, interval);
      while (!afterCompletion(next)) next = addDays(next, interval);
      return next;
    }

    case RecurrenceFrequency.WEEKLY: {
      const days =
        recurrence.weekdays && recurrence.weekdays.length > 0
          ? recurrence.weekdays
          : [weekday(base)];
      // Weeks are counted from the Sunday of the base's week, so "every two
      // weeks on Mon and Thu" keeps to the same fortnight.
      const weekStart = addDays(base, -weekday(base));

      for (let offset = 1; offset <= 7 * interval * 120; offset += 1) {
        const candidate = addDays(base, offset);
        const week = Math.floor((toTime(candidate) - toTime(weekStart)) / (7 * 86_400_000));
        if (week % interval !== 0) continue;
        if (!days.includes(weekday(candidate))) continue;
        if (afterCompletion(candidate)) return candidate;
      }
      return addDays(completedOn, 7 * interval);
    }

    case RecurrenceFrequency.MONTHLY:
    case RecurrenceFrequency.YEARLY: {
      const step = recurrence.frequency === RecurrenceFrequency.YEARLY ? 12 * interval : interval;
      for (let count = 1; count <= 1200; count += 1) {
        const candidate = addMonths(base, step * count, base.day);
        if (afterCompletion(candidate)) return candidate;
      }
      return addMonths(completedOn, step, completedOn.day);
    }
  }
}
