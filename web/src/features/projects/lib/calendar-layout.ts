import { fromYmd, ymd } from '@/lib/utils/dates';

/*
 * The arithmetic behind the project Calendar: which days a month shows, how
 * a week's items stack into lanes, and how a schedule moves when a task is
 * dragged to another day. Everything works on `yyyy-mm-dd` keys — calendar
 * days, which sort as text and never drift with the reader's timezone.
 */

/** Days between two keys, `to - from`. */
export function dayDiff(from: string, to: string): number {
  return Math.round((fromYmd(to).getTime() - fromYmd(from).getTime()) / 86_400_000);
}

export function addDays(key: string, days: number): string {
  const date = fromYmd(key);
  date.setDate(date.getDate() + days);
  return ymd(date);
}

/** First of the month, as a key. */
export function monthStart(date: Date): string {
  return ymd(new Date(date.getFullYear(), date.getMonth(), 1));
}

/**
 * Six Monday-first weeks covering the month — always six, so the grid keeps
 * one height as the reader pages through months.
 */
export function monthWeeks(firstOfMonth: string): string[][] {
  const first = fromYmd(firstOfMonth);
  const offset = (first.getDay() + 6) % 7;
  const start = addDays(firstOfMonth, -offset);

  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)),
  );
}

/** An item the calendar can place: one day, or a span of days. */
export interface CalendarSpan {
  id: string;
  /** Inclusive. Equal to `end` for a task with only a due date. */
  start: string;
  end: string;
}

export interface PlacedSpan<T extends CalendarSpan> {
  item: T;
  lane: number;
  /** 0–6, the column the bar starts in within this week. */
  column: number;
  /** How many columns it covers within this week. */
  span: number;
  /** The bar carries on from the previous week / into the next. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/**
 * Stacks one week's items into lanes, Asana's way: longer bars claim the top
 * lanes, and an item takes the first lane free across all of its days.
 *
 * Items beyond `maxLanes` are not drawn; each day they would have covered
 * counts them in `hidden`, which is what a "+2 more" under the day reads.
 */
export function layoutWeek<T extends CalendarSpan>(
  week: string[],
  items: readonly T[],
  maxLanes: number,
): { placed: PlacedSpan<T>[]; hidden: number[] } {
  const first = week[0] as string;
  const last = week[week.length - 1] as string;

  const inWeek = items
    .filter((item) => item.start <= last && item.end >= first)
    .map((item) => {
      const from = item.start < first ? first : item.start;
      const to = item.end > last ? last : item.end;
      return {
        item,
        column: dayDiff(first, from),
        span: dayDiff(from, to) + 1,
        continuesBefore: item.start < first,
        continuesAfter: item.end > last,
      };
    })
    .sort((a, b) => a.column - b.column || b.span - a.span || a.item.id.localeCompare(b.item.id));

  // occupied[lane][column]
  const occupied: boolean[][] = [];
  const placed: PlacedSpan<T>[] = [];
  const hidden = Array.from({ length: 7 }, () => 0);

  for (const entry of inWeek) {
    let lane = 0;
    for (; ; lane += 1) {
      const row = occupied[lane] ?? (occupied[lane] = Array.from({ length: 7 }, () => false));
      let free = true;
      for (let column = entry.column; column < entry.column + entry.span; column += 1) {
        if (row[column]) {
          free = false;
          break;
        }
      }
      if (free) break;
    }

    if (lane >= maxLanes) {
      for (let column = entry.column; column < entry.column + entry.span; column += 1) {
        hidden[column] = (hidden[column] ?? 0) + 1;
      }
      continue;
    }

    const row = occupied[lane] as boolean[];
    for (let column = entry.column; column < entry.column + entry.span; column += 1) {
      row[column] = true;
    }
    placed.push({ ...entry, lane });
  }

  return { placed, hidden };
}

/** A task's dates as stored: calendar dates at UTC midnight, optional instants beside them. */
export interface StoredSchedule {
  startDate: string | null;
  startAt: string | null;
  dueDate: string | null;
  dueAt: string | null;
}

function shiftInstant(iso: string | null, days: number): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  // Through local calendar fields, so a move across a DST change keeps the
  // same clock time rather than drifting by an hour.
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function shiftDate(iso: string | null, days: number): string | null {
  if (!iso) return null;
  return `${addDays(iso.slice(0, 10), days)}T00:00:00.000Z`;
}

/**
 * Moves a whole schedule by some days — what dropping a task on another day
 * does. The start moves with the due date so a three-day task stays three
 * days long, and a time of day stays the same time on the new day.
 */
export function shiftSchedule(schedule: StoredSchedule, days: number): StoredSchedule {
  return {
    startDate: shiftDate(schedule.startDate, days),
    startAt: shiftInstant(schedule.startAt, days),
    dueDate: shiftDate(schedule.dueDate, days),
    dueAt: shiftInstant(schedule.dueAt, days),
  };
}
