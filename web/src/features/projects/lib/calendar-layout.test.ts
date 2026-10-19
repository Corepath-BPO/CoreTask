import { describe, expect, it } from 'vitest';

import { addDays, dayDiff, layoutWeek, monthWeeks, shiftSchedule } from './calendar-layout';

describe('monthWeeks', () => {
  it('starts on the Monday on or before the first and always shows six weeks', () => {
    // October 2026 starts on a Thursday.
    const weeks = monthWeeks('2026-10-01');
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]).toBe('2026-09-28');
    expect(weeks[0]?.[3]).toBe('2026-10-01');
    expect(weeks[5]?.[6]).toBe('2026-11-08');
  });

  it('starts on the first itself when the month begins on a Monday', () => {
    expect(monthWeeks('2026-06-01')[0]?.[0]).toBe('2026-06-01');
  });
});

describe('dayDiff and addDays', () => {
  it('count calendar days across a month end', () => {
    expect(dayDiff('2026-10-30', '2026-11-02')).toBe(3);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('layoutWeek', () => {
  const week = [
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-10',
    '2026-10-11',
  ];

  it('clips a span to the week and marks where it continues', () => {
    const { placed } = layoutWeek(week, [{ id: 'a', start: '2026-10-01', end: '2026-10-07' }], 3);
    expect(placed[0]).toMatchObject({
      column: 0,
      span: 3,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it('gives longer bars the top lane and stacks overlaps beneath', () => {
    const { placed } = layoutWeek(
      week,
      [
        { id: 'short', start: '2026-10-06', end: '2026-10-06' },
        { id: 'long', start: '2026-10-05', end: '2026-10-09' },
      ],
      3,
    );
    const lanes = Object.fromEntries(placed.map((entry) => [entry.item.id, entry.lane]));
    expect(lanes).toEqual({ long: 0, short: 1 });
  });

  it('reuses a lane once it is free again', () => {
    const { placed } = layoutWeek(
      week,
      [
        { id: 'mon', start: '2026-10-05', end: '2026-10-05' },
        { id: 'tue', start: '2026-10-06', end: '2026-10-06' },
      ],
      3,
    );
    expect(placed.every((entry) => entry.lane === 0)).toBe(true);
  });

  it('counts what does not fit, per day it would have covered', () => {
    const items = ['a', 'b', 'c'].map((id) => ({ id, start: '2026-10-07', end: '2026-10-08' }));
    const { placed, hidden } = layoutWeek(week, items, 2);
    expect(placed).toHaveLength(2);
    expect(hidden).toEqual([0, 0, 1, 1, 0, 0, 0]);
  });

  it('leaves out items outside the week', () => {
    const { placed } = layoutWeek(week, [{ id: 'x', start: '2026-10-20', end: '2026-10-20' }], 3);
    expect(placed).toHaveLength(0);
  });
});

describe('shiftSchedule', () => {
  it('moves start and due together, keeping the length', () => {
    const moved = shiftSchedule(
      {
        startDate: '2026-10-05T00:00:00.000Z',
        startAt: null,
        dueDate: '2026-10-07T00:00:00.000Z',
        dueAt: null,
      },
      3,
    );
    expect(moved).toEqual({
      startDate: '2026-10-08T00:00:00.000Z',
      startAt: null,
      dueDate: '2026-10-10T00:00:00.000Z',
      dueAt: null,
    });
  });

  it('keeps a time of day on the new day', () => {
    const at = new Date(2026, 9, 7, 15, 30).toISOString();
    const moved = shiftSchedule(
      { startDate: null, startAt: null, dueDate: '2026-10-07T00:00:00.000Z', dueAt: at },
      -2,
    );
    const local = new Date(moved.dueAt as string);
    expect(local.getDate()).toBe(5);
    expect(local.getHours()).toBe(15);
    expect(local.getMinutes()).toBe(30);
  });
});
