/**
 * Dates and times on tasks.
 *
 * A task's start and due are each a pair — see
 * docs/architecture/task-dates-and-rich-text.md:
 *
 * - `dueDate` is the calendar date, stored at UTC midnight. Only its date part
 *   means anything, and reading it through `new Date()` in a timezone west of
 *   Greenwich lands on the evening *before*. Every reader here goes through
 *   `asLocalDate` for that reason.
 * - `dueAt` is the exact instant, present only when a time of day was chosen.
 *   It is a real moment and is shown in the viewer's own timezone.
 *
 * The client keeps the pair consistent: whenever it sends a `dueAt`, it sends
 * the `dueDate` that instant falls on locally.
 */

import { asLocalDate, daysUntil, formatDate } from './format';

/** `yyyy-mm-dd` of a local Date — the shape `<input type="date">` and the picker use. */
export function ymd(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Local midnight of a `yyyy-mm-dd`. */
export function fromYmd(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}

/** The `yyyy-mm-dd` an ISO calendar date carries. */
export function calendarDateOf(iso: string): string {
  return iso.slice(0, 10);
}

/** The ISO calendar date the API stores for a `yyyy-mm-dd`. */
export function toIsoCalendarDate(value: string): string {
  return `${value}T00:00:00.000Z`;
}

/** `HH:mm`, 24-hour, of a local Date — what `<input type="time">` speaks. */
export function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** The local `HH:mm` of an ISO instant. */
export function timeOf(iso: string): string {
  return hhmm(new Date(iso));
}

/** A calendar date and a local `HH:mm`, as the ISO instant they name. */
export function toInstant(date: string, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const at = fromYmd(date);
  at.setHours(hours as number, minutes as number, 0, 0);
  return at.toISOString();
}

/** The local calendar date an ISO instant falls on. */
export function localCalendarDateOf(iso: string): string {
  return ymd(new Date(iso));
}

/** The ISO calendar date some days from today — "due today", "due tomorrow". */
export function calendarDateFromNow(days: number): string {
  const day = new Date();
  day.setDate(day.getDate() + days);
  return toIsoCalendarDate(ymd(day));
}

const TIME_FORMAT = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

/** "3:00 PM". */
export function formatTime(iso: string): string {
  return TIME_FORMAT.format(new Date(iso));
}

/** Start and due, as the API hands them out. */
export interface Schedule {
  startDate: string | null;
  startAt: string | null;
  dueDate: string | null;
  dueAt: string | null;
}

/** Calendar days from today to the due date; negative is overdue. Null without one. */
export function dueDayOffset(schedule: Pick<Schedule, 'dueDate'>): number | null {
  return schedule.dueDate ? daysUntil(schedule.dueDate) : null;
}

/**
 * Late, by the rule the API's rollup uses: a task with a time is late once
 * that moment passes; one without is late only once its day is over.
 */
export function isOverdue(
  schedule: Pick<Schedule, 'dueDate' | 'dueAt'>,
  now = new Date(),
): boolean {
  if (!schedule.dueDate) return false;
  if (schedule.dueAt) return new Date(schedule.dueAt).getTime() < now.getTime();
  return daysUntil(schedule.dueDate) < 0;
}

/** "Sep 5", with the year only once it is not this year. */
function shortDate(iso: string): string {
  const date = asLocalDate(iso);
  const thisYear = date.getFullYear() === new Date().getFullYear();
  return formatDate(
    date,
    thisYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  );
}

/** "Today", "Tomorrow", "Yesterday", or the short date. */
function dayWord(iso: string): string {
  const days = daysUntil(iso);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return shortDate(iso);
}

/**
 * The words the app uses for a due date.
 *
 * Date-only keeps the countdown vocabulary the list, board and dashboard
 * already speak — "In 3d", "2d overdue". A time is a moment rather than a
 * countdown, so it reads as "Tomorrow at 3:00 PM" and lets the colour say
 * whether that moment has passed. Finished work shows the plain date: a task
 * completed last week is not "5d overdue".
 */
export function formatDue(
  schedule: Pick<Schedule, 'dueDate' | 'dueAt'>,
  options: { done?: boolean } = {},
): string {
  if (!schedule.dueDate) return '';

  if (schedule.dueAt) {
    const day = options.done ? shortDate(schedule.dueDate) : dayWord(schedule.dueDate);
    return `${day} at ${formatTime(schedule.dueAt)}`;
  }

  if (options.done) return shortDate(schedule.dueDate);

  const days = daysUntil(schedule.dueDate);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days <= 7) return `In ${days}d`;

  return shortDate(schedule.dueDate);
}

/**
 * Start and due together: "Sep 1 – Sep 5", or "Sep 1, 9:00 AM – Sep 5, 3:00 PM".
 *
 * A range is two fixed points, so both ends are dates rather than "Today" —
 * "Sep 1 – Tomorrow" reads as a riddle. Without a start it is just the due.
 */
export function formatSchedule(schedule: Schedule, options: { done?: boolean } = {}): string {
  if (!schedule.dueDate) return '';
  if (!schedule.startDate) return formatDue(schedule, options);

  // Starting and ending on the same day is a day, not a range — with both
  // times it is a window on that day: "Sep 5, 9:00 AM – 3:00 PM".
  if (calendarDateOf(schedule.startDate) === calendarDateOf(schedule.dueDate)) {
    if (schedule.startAt && schedule.dueAt) {
      const day = options.done ? shortDate(schedule.dueDate) : dayWord(schedule.dueDate);
      return `${day}, ${formatTime(schedule.startAt)} – ${formatTime(schedule.dueAt)}`;
    }
    return formatDue(schedule, options);
  }

  const end = schedule.dueAt
    ? `${shortDate(schedule.dueDate)}, ${formatTime(schedule.dueAt)}`
    : shortDate(schedule.dueDate);
  const start = schedule.startAt
    ? `${shortDate(schedule.startDate)}, ${formatTime(schedule.startAt)}`
    : shortDate(schedule.startDate);

  return `${start} – ${end}`;
}
