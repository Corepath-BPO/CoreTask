import { AppException } from '../exceptions/app.exception';

/**
 * A task's start and due are each a pair: the calendar date and, optionally,
 * the exact instant.
 *
 * `dueDate` is stored at UTC midnight and read as a date — the calendar, the
 * "overdue" rollup and every automation condition look only at it. `dueAt` is
 * set when somebody chose a time of day and is the instant that time means.
 * Keeping the date its own column is what lets a time be added without every
 * date-only reader changing; the same shape Asana's `due_on` / `due_at` use.
 * See docs/architecture/task-dates-and-rich-text.md.
 */

/** The UTC calendar date of an instant, at midnight — what the date columns hold. */
export function toCalendarDate(value: string | Date): Date {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export interface SchedulePair {
  date: Date | null;
  at: Date | null;
}

export interface ScheduleInput {
  date?: string | null | undefined;
  at?: string | null | undefined;
}

/**
 * How a date and its time move together.
 *
 * - Clearing the date clears the time: a time of day on no day is nothing.
 * - Setting a time without a date, when there is none, is refused rather than
 *   quietly dropped — the caller believed it saved something.
 * - Moving the date while saying nothing about the time carries the time of
 *   day across to the new date, which is what "push it to Friday" means to
 *   the person doing it. The offset from UTC midnight stands in for the wall
 *   clock; it drifts by an hour only across a daylight-saving change.
 *
 * Returns nothing when neither half was mentioned, so an unrelated update does
 * not touch the columns.
 */
export function resolveSchedule(
  existing: SchedulePair,
  input: ScheduleInput,
  label: 'start' | 'due',
): Partial<SchedulePair> {
  if (input.date === undefined && input.at === undefined) return {};

  const date =
    input.date === undefined
      ? existing.date
      : input.date === null
        ? null
        : toCalendarDate(input.date);

  if (date === null) {
    if (typeof input.at === 'string') {
      throw AppException.badRequest('BAD_REQUEST', `A ${label} time needs a ${label} date.`);
    }
    return { date: null, at: null };
  }

  if (input.at !== undefined) {
    return { date, at: input.at === null ? null : new Date(input.at) };
  }

  if (existing.at && existing.date) {
    const offset = existing.at.getTime() - existing.date.getTime();
    return { date, at: new Date(date.getTime() + offset) };
  }

  return { date, at: null };
}

/** The pair a brand-new record gets: nothing to carry over. */
export function initialSchedule(input: ScheduleInput, label: 'start' | 'due'): SchedulePair {
  const resolved = resolveSchedule({ date: null, at: null }, input, label);
  return { date: resolved.date ?? null, at: resolved.at ?? null };
}

/** Midnight UTC of the current day — the first calendar date that is not yet overdue. */
export function startOfTodayUtc(now = new Date()): Date {
  return toCalendarDate(now);
}
