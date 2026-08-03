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

export function formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('en', options ?? { month: 'short', day: 'numeric' }).format(date);
}

/** Calendar-day difference, ignoring time of day. Negative means overdue. */
export function daysUntil(value: string | Date): number {
  const date = typeof value === 'string' ? new Date(value) : value;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const target = new Date(date);
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
