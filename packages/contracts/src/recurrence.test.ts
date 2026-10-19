import { describe, expect, it } from 'vitest';

import {
  describeRecurrence,
  nextOccurrenceDay,
  readRecurrence,
  recurrenceProblems,
  type TaskRecurrence,
} from './recurrence';

const day = (iso: string) => {
  const [year, month, date] = iso.split('-').map(Number) as [number, number, number];
  return { year, month, day: date };
};
const iso = (value: { year: number; month: number; day: number }) =>
  `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}`;

const next = (recurrence: TaskRecurrence, due: string | null, completed: string) =>
  iso(nextOccurrenceDay(recurrence, due ? day(due) : null, day(completed)));

describe('the next occurrence', () => {
  it('counts daily and weekly repeats from the due date', () => {
    expect(next({ frequency: 'DAILY', interval: 1 }, '2026-10-12', '2026-10-12')).toBe(
      '2026-10-13',
    );
    // Monday 12 October, weekly on its own weekday.
    expect(next({ frequency: 'WEEKLY', interval: 1 }, '2026-10-12', '2026-10-12')).toBe(
      '2026-10-19',
    );
  });

  it('never lands on or before the day it was completed', () => {
    // Due Monday the 5th, finished late on Wednesday the 14th: next Monday.
    expect(next({ frequency: 'WEEKLY', interval: 1 }, '2026-10-05', '2026-10-14')).toBe(
      '2026-10-19',
    );
    expect(next({ frequency: 'DAILY', interval: 2 }, '2026-10-01', '2026-10-10')).toBe(
      '2026-10-11',
    );
  });

  it('walks the chosen weekdays, keeping to the fortnight for every two weeks', () => {
    const monThu: TaskRecurrence = { frequency: 'WEEKLY', interval: 1, weekdays: [1, 4] };
    expect(next(monThu, '2026-10-12', '2026-10-12')).toBe('2026-10-15');
    expect(next(monThu, '2026-10-15', '2026-10-15')).toBe('2026-10-19');

    const fortnightly: TaskRecurrence = { frequency: 'WEEKLY', interval: 2, weekdays: [1] };
    expect(next(fortnightly, '2026-10-12', '2026-10-12')).toBe('2026-10-26');
  });

  it('keeps the day of the month, or the month’s last day when it is short', () => {
    expect(next({ frequency: 'MONTHLY', interval: 1 }, '2026-01-31', '2026-01-31')).toBe(
      '2026-02-28',
    );
    expect(next({ frequency: 'MONTHLY', interval: 3 }, '2026-10-10', '2026-10-10')).toBe(
      '2027-01-10',
    );
    expect(next({ frequency: 'YEARLY', interval: 1 }, '2028-02-29', '2028-02-29')).toBe(
      '2029-02-28',
    );
  });

  it('counts "periodically" from the completion, and uses the completion day with no due date', () => {
    expect(next({ frequency: 'PERIODICALLY', interval: 10 }, '2026-10-01', '2026-10-05')).toBe(
      '2026-10-15',
    );
    expect(next({ frequency: 'DAILY', interval: 1 }, null, '2026-10-05')).toBe('2026-10-06');
  });
});

describe('reading and describing a repeat', () => {
  it('validates and cleans', () => {
    expect(recurrenceProblems({ frequency: 'HOURLY', interval: 0, weekdays: [9] })).toEqual([
      'Choose how often the task repeats.',
      'Repeat every 1 to 365.',
      'Choose days of the week from Sunday to Saturday.',
    ]);
    expect(readRecurrence({ frequency: 'WEEKLY', interval: 1, weekdays: [4, 1, 1] })).toEqual({
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: [1, 4],
    });
    expect(readRecurrence({ frequency: 'DAILY', interval: 1, weekdays: [1] })).toEqual({
      frequency: 'DAILY',
      interval: 1,
    });
    expect(readRecurrence('weekly')).toBeNull();
  });

  it('says it in words', () => {
    expect(describeRecurrence({ frequency: 'WEEKLY', interval: 2, weekdays: [1, 3] })).toBe(
      'Every 2 weeks on Mon, Wed',
    );
    expect(describeRecurrence({ frequency: 'MONTHLY', interval: 1 })).toBe('Every month');
    expect(describeRecurrence({ frequency: 'PERIODICALLY', interval: 1 })).toBe(
      '1 day after completion',
    );
  });
});
