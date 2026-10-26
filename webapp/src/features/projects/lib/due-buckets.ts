import { calendarDateOf, toIsoCalendarDate, ymd } from '@/lib/utils';

/** One heading of a by-due-date grouping: a run of calendar days, ends inclusive. */
export interface DueBucket {
  key: string;
  name: string;
  /** `yyyy-mm-dd`, or null for "since forever". */
  from: string | null;
  /** `yyyy-mm-dd`, or null for "from then on". */
  to: string | null;
}

/** A `yyyy-mm-dd` moved by whole days, without the time zone in the way. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
}

/** Monday 0 … Sunday 6. */
function weekdayOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

/**
 * The headings Asana groups by due date under, from the reader's today:
 * overdue, today, tomorrow, the rest of this week, next week, later. A
 * heading with no days left in it this week (on a Saturday, "This week" has
 * none) is not drawn, and no two headings share a day.
 */
export function dueBuckets(now: Date): DueBucket[] {
  const today = ymd(now);
  const tomorrow = addDays(today, 1);
  const sunday = addDays(today, 6 - weekdayOf(today));
  const nextSunday = addDays(sunday, 7);
  const afterTomorrow = addDays(today, 2);
  const nextMonday = addDays(sunday, 1);
  const buckets: DueBucket[] = [
    { key: 'overdue', name: 'Overdue', from: null, to: addDays(today, -1) },
    { key: 'today', name: 'Today', from: today, to: today },
    { key: 'tomorrow', name: 'Tomorrow', from: tomorrow, to: tomorrow },
    { key: 'this-week', name: 'This week', from: afterTomorrow, to: sunday },
    {
      key: 'next-week',
      name: 'Next week',
      from: nextMonday > afterTomorrow ? nextMonday : afterTomorrow,
      to: nextSunday,
    },
    { key: 'later', name: 'Later', from: addDays(nextSunday, 1), to: null },
  ];
  return buckets.filter((bucket) => !bucket.from || !bucket.to || bucket.from <= bucket.to);
}

/** Which heading a due date falls under; null for no due date. */
export function bucketOf(dueDate: string | null, buckets: readonly DueBucket[]): string | null {
  if (!dueDate) return null;
  const day = calendarDateOf(dueDate);
  const bucket = buckets.find(
    (entry) => (entry.from === null || day >= entry.from) && (entry.to === null || day <= entry.to),
  );
  return bucket?.key ?? null;
}

/**
 * The due date a row dropped under a heading takes: today, tomorrow, Friday
 * of this week (or the first day left in it), next Monday — or none. The open
 * ends, overdue and later, name no one day, so a drop there is refused.
 */
export function dropDueDate(
  key: string | null,
  now: Date,
): { ok: true; dueDate: string | null } | { ok: false; reason: string } {
  if (key === null) return { ok: true, dueDate: null };
  const bucket = dueBuckets(now).find((entry) => entry.key === key);
  if (!bucket || bucket.from === null || bucket.to === null) {
    return { ok: false, reason: 'Pick that date from the task itself.' };
  }
  if (bucket.key === 'this-week') {
    const friday = addDays(bucket.to, -2);
    return { ok: true, dueDate: friday >= bucket.from ? friday : bucket.from };
  }
  return { ok: true, dueDate: bucket.from };
}

/**
 * The change that moves a row's due date to `dueDate`, its time of day kept:
 * a due time moves by the same number of days as the date.
 */
export function dueDatePayload(
  row: { dueDate: string | null; dueAt: string | null },
  dueDate: string | null,
): { dueDate: string | null; dueAt: string | null } {
  if (dueDate === null) return { dueDate: null, dueAt: null };
  if (!row.dueAt || !row.dueDate) return { dueDate: toIsoCalendarDate(dueDate), dueAt: null };
  const shift =
    Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${calendarDateOf(row.dueDate)}T00:00:00Z`);
  return {
    dueDate: toIsoCalendarDate(dueDate),
    dueAt: new Date(Date.parse(row.dueAt) + shift).toISOString(),
  };
}
