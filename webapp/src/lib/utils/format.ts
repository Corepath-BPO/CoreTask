/** Presentation helpers shared across features. All are pure. */

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'second' },
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: 4.34524, unit: 'week' },
  { amount: 12, unit: 'month' },
  { amount: Number.POSITIVE_INFINITY, unit: 'year' },
];

/** "3 days ago" / "in 2 hours". */
export function formatRelativeTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  let duration = (date.getTime() - Date.now()) / 1000;

  for (const division of DIVISIONS) {
    if (Math.abs(duration) < division.amount) {
      return RELATIVE.format(Math.round(duration), division.unit);
    }
    duration /= division.amount;
  }

  return RELATIVE.format(Math.round(duration), 'year');
}

/**
 * An ISO calendar date — a date column, which the API stores at UTC midnight.
 * `2026-09-05` and `2026-09-05T00:00:00.000Z` both mean "the fifth", wherever
 * the reader is.
 */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/;

/**
 * Reads a value as a Date the local calendar agrees with.
 *
 * A calendar date is rebuilt from its year, month and day at local midnight.
 * `new Date('2026-09-05T00:00:00.000Z')` in Texas is the evening of the
 * fourth, which is how every due date in the app used to render a day early
 * for anyone west of Greenwich. An instant — `createdAt`, a `dueAt` — carries
 * its clock and is left alone.
 */
export function asLocalDate(value: string | Date): Date {
  if (typeof value !== 'string') return value;
  if (CALENDAR_DATE.test(value)) {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return new Date(year as number, (month as number) - 1, day as number);
  }
  return new Date(value);
}

export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en', options ?? { month: 'short', day: 'numeric' }).format(
    asLocalDate(value),
  );
}

/** Calendar-day difference, ignoring time of day. Negative means overdue. */
export function daysUntil(value: string | Date): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(asLocalDate(value));
  target.setHours(0, 0, 0, 0);

  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function formatDueDate(value: string | Date): string {
  const days = daysUntil(value);

  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days <= 7) return `In ${days}d`;

  return formatDate(value);
}

/** Two-letter monogram for avatar fallbacks. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';

  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';

  return (first + last).toUpperCase();
}

/** Turns `IN_PROGRESS` into `In progress` for display. */
export function humanizeEnum(value: string): string {
  const lower = value.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function percentage(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}
