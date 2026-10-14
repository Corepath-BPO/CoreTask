import { fromYmd } from '@/lib/utils/dates';

import { addDays, dayDiff } from './calendar-layout';

/*
 * The day scale under the project Timeline. Every position is a day index
 * from the range's first day, times pixels per day — calendar-day keys in,
 * pixels out, so nothing here ever meets a timezone.
 */

export interface DayRange {
  /** Inclusive first day, a Monday. */
  start: string;
  /** Number of days shown. */
  days: number;
}

/**
 * The days the timeline spans: every dated item, today, and some room either
 * side — snapped to whole weeks so the header's week boundaries line up with
 * the grid. At least `minDays`, so a sparse project still has a canvas.
 */
export function buildDayRange(
  keys: readonly string[],
  today: string,
  minDays: number,
  padDays = 14,
): DayRange {
  const all = [...keys, today].sort();
  let first = addDays(all[0] as string, -padDays);
  let last = addDays(all[all.length - 1] as string, padDays * 2);

  // Monday on or before the first day.
  const firstDate = fromYmd(first);
  first = addDays(first, -((firstDate.getDay() + 6) % 7));

  let days = dayDiff(first, last) + 1;
  if (days < minDays) {
    last = addDays(first, minDays - 1);
    days = minDays;
  }
  // Whole weeks.
  days = Math.ceil(days / 7) * 7;

  return { start: first, days };
}

export interface HeaderSegment {
  key: string;
  label: string;
  /** Day index of the segment's first day. */
  offset: number;
  /** Days the segment covers within the range. */
  length: number;
}

const MONTH_LABEL = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
const SHORT_MONTH = new Intl.DateTimeFormat('en', { month: 'short' });

/** Month bands for the header's top row, clipped to the range. */
export function monthSegments(range: DayRange): HeaderSegment[] {
  const segments: HeaderSegment[] = [];
  let offset = 0;

  while (offset < range.days) {
    const key = addDays(range.start, offset);
    const date = fromYmd(key);
    const nextMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    const daysLeftInMonth = Math.round((nextMonth.getTime() - date.getTime()) / 86_400_000);
    const length = Math.min(daysLeftInMonth, range.days - offset);

    segments.push({ key, label: MONTH_LABEL.format(date), offset, length });
    offset += length;
  }

  return segments;
}

/** Week bands (Monday-first), labelled with the Monday's date. */
export function weekSegments(range: DayRange): HeaderSegment[] {
  const segments: HeaderSegment[] = [];
  for (let offset = 0; offset < range.days; offset += 7) {
    const key = addDays(range.start, offset);
    const date = fromYmd(key);
    segments.push({
      key,
      label: `${SHORT_MONTH.format(date)} ${date.getDate()}`,
      offset,
      length: Math.min(7, range.days - offset),
    });
  }
  return segments;
}

/** A bar's horizontal extent: from the first day's left edge to the last day's right edge. */
export function barSpan(
  range: DayRange,
  start: string,
  end: string,
  pxPerDay: number,
): { left: number; width: number } {
  const from = dayDiff(range.start, start);
  const to = dayDiff(range.start, end);
  return { left: from * pxPerDay, width: Math.max(1, to - from + 1) * pxPerDay };
}

/** The day under an x position, clamped to the range. */
export function dayAt(range: DayRange, x: number, pxPerDay: number): string {
  const index = Math.min(range.days - 1, Math.max(0, Math.floor(x / pxPerDay)));
  return addDays(range.start, index);
}

/**
 * What a drag does to a bar's two ends, in whole days.
 *
 * `move` shifts both; `start` and `end` stretch one side and stop it crossing
 * the other, so a bar can shrink to one day but never turn inside out.
 */
export function dragEnds(
  mode: 'move' | 'start' | 'end',
  start: string,
  end: string,
  deltaDays: number,
): { start: string; end: string } {
  if (mode === 'move') return { start: addDays(start, deltaDays), end: addDays(end, deltaDays) };
  if (mode === 'start') {
    const next = addDays(start, deltaDays);
    return { start: next > end ? end : next, end };
  }
  const next = addDays(end, deltaDays);
  return { start, end: next < start ? start : next };
}
