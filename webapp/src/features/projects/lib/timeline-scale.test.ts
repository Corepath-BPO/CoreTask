import { describe, expect, it } from 'vitest';

import {
  barSpan,
  buildDayRange,
  dayAt,
  dragEnds,
  monthSegments,
  weekSegments,
} from './timeline-scale';

describe('buildDayRange', () => {
  it('starts on a Monday and covers whole weeks', () => {
    const range = buildDayRange(['2026-10-15'], '2026-10-10', 28);
    expect(new Date(`${range.start}T12:00:00`).getDay()).toBe(1);
    expect(range.days % 7).toBe(0);
  });

  it('includes today and every item, with room either side', () => {
    const range = buildDayRange(['2026-12-01'], '2026-10-10', 28);
    expect(range.start <= '2026-10-10').toBe(true);
    const lastDay = new Date(`${range.start}T12:00:00`);
    lastDay.setDate(lastDay.getDate() + range.days - 1);
    expect(lastDay.toISOString().slice(0, 10) >= '2026-12-01').toBe(true);
  });

  it('honours the minimum length for an empty project', () => {
    expect(buildDayRange([], '2026-10-10', 84).days).toBeGreaterThanOrEqual(84);
  });
});

describe('segments', () => {
  const range = { start: '2026-09-28', days: 42 };

  it('cuts months at their real boundaries', () => {
    const months = monthSegments(range);
    expect(months.map((month) => [month.offset, month.length])).toEqual([
      [0, 3],
      [3, 31],
      [34, 8],
    ]);
    expect(months[1]?.label).toBe('October 2026');
  });

  it('labels weeks by their Monday', () => {
    const weeks = weekSegments(range);
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.label).toBe('Sep 28');
    expect(weeks[1]?.label).toBe('Oct 5');
  });
});

describe('barSpan and dayAt', () => {
  const range = { start: '2026-10-05', days: 28 };

  it('spans from the first day’s left edge to the last day’s right edge', () => {
    expect(barSpan(range, '2026-10-06', '2026-10-08', 20)).toEqual({ left: 20, width: 60 });
    expect(barSpan(range, '2026-10-05', '2026-10-05', 20)).toEqual({ left: 0, width: 20 });
  });

  it('maps an x back to its day, clamped to the range', () => {
    expect(dayAt(range, 45, 20)).toBe('2026-10-07');
    expect(dayAt(range, -10, 20)).toBe('2026-10-05');
    expect(dayAt(range, 99_999, 20)).toBe('2026-11-01');
  });
});

describe('dragEnds', () => {
  it('moves both ends together', () => {
    expect(dragEnds('move', '2026-10-05', '2026-10-07', 2)).toEqual({
      start: '2026-10-07',
      end: '2026-10-09',
    });
  });

  it('stretches one end and never lets it cross the other', () => {
    expect(dragEnds('end', '2026-10-05', '2026-10-07', 3).end).toBe('2026-10-10');
    expect(dragEnds('end', '2026-10-05', '2026-10-07', -9)).toEqual({
      start: '2026-10-05',
      end: '2026-10-05',
    });
    expect(dragEnds('start', '2026-10-05', '2026-10-07', 9)).toEqual({
      start: '2026-10-07',
      end: '2026-10-07',
    });
  });
});
