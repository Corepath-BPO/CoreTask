import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  calendarDateOf,
  formatDue,
  formatSchedule,
  fromYmd,
  isOverdue,
  localCalendarDateOf,
  timeOf,
  toInstant,
  toIsoCalendarDate,
  ymd,
} from './dates';

/** A local Date some days from now, at local midnight. */
const dayFromNow = (days: number) => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
};

/** The ISO calendar date the API would hand out for that day. */
const isoDay = (days: number) => toIsoCalendarDate(ymd(dayFromNow(days)));

describe('ymd / fromYmd', () => {
  it('round-trips a local calendar date', () => {
    const date = new Date(2026, 8, 5);
    expect(ymd(date)).toBe('2026-09-05');
    expect(fromYmd('2026-09-05').getTime()).toBe(date.getTime());
  });
});

describe('calendar dates on the wire', () => {
  it('reads and writes the API shape without touching the timezone', () => {
    expect(calendarDateOf('2026-09-05T00:00:00.000Z')).toBe('2026-09-05');
    expect(toIsoCalendarDate('2026-09-05')).toBe('2026-09-05T00:00:00.000Z');
  });
});

describe('instants', () => {
  it('turns a day and a local time into the instant they name, and back', () => {
    const at = toInstant('2026-09-05', '15:30');
    expect(timeOf(at)).toBe('15:30');
    expect(localCalendarDateOf(at)).toBe('2026-09-05');
  });
});

describe('formatDue', () => {
  it('keeps the countdown vocabulary for date-only deadlines', () => {
    expect(formatDue({ dueDate: isoDay(0), dueAt: null })).toBe('Today');
    expect(formatDue({ dueDate: isoDay(1), dueAt: null })).toBe('Tomorrow');
    expect(formatDue({ dueDate: isoDay(3), dueAt: null })).toBe('In 3d');
    expect(formatDue({ dueDate: isoDay(-2), dueAt: null })).toBe('2d overdue');
  });

  it('reads a calendar date as the day it names, wherever the reader is', () => {
    // Local midnight of the fifth is the fifth even in a timezone west of
    // UTC, where the stored instant is the evening of the fourth.
    const fifth = new Date(2026, 8, 5);
    expect(formatDue({ dueDate: '2026-09-05T00:00:00.000Z', dueAt: null }, { done: true })).toBe(
      new Intl.DateTimeFormat('en', {
        month: 'short',
        day: 'numeric',
        ...(fifth.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
      }).format(fifth),
    );
  });

  it('says the time once there is one, and drops the countdown', () => {
    const day = ymd(dayFromNow(1));
    const at = toInstant(day, '15:00');
    expect(formatDue({ dueDate: toIsoCalendarDate(day), dueAt: at })).toBe('Tomorrow at 3:00 PM');
  });

  it('shows finished work its date, never a countdown', () => {
    expect(formatDue({ dueDate: isoDay(-2), dueAt: null }, { done: true })).not.toContain(
      'overdue',
    );
  });

  it('is empty without a due date', () => {
    expect(formatDue({ dueDate: null, dueAt: null })).toBe('');
  });
});

describe('formatSchedule', () => {
  it('draws a range as two fixed dates', () => {
    expect(
      formatSchedule({
        startDate: '2026-09-01T00:00:00.000Z',
        startAt: null,
        dueDate: '2026-09-05T00:00:00.000Z',
        dueAt: null,
      }),
    ).toMatch(/^Sep 1(, \d{4})? – Sep 5(, \d{4})?$/);
  });

  it('puts the times beside each end when they exist', () => {
    expect(
      formatSchedule({
        startDate: '2026-09-01T00:00:00.000Z',
        startAt: toInstant('2026-09-01', '09:00'),
        dueDate: '2026-09-05T00:00:00.000Z',
        dueAt: toInstant('2026-09-05', '15:00'),
      }),
    ).toMatch(/^Sep 1(, \d{4})?, 9:00 AM – Sep 5(, \d{4})?, 3:00 PM$/);
  });

  it('reads a same-day start and due as one day, or one window', () => {
    const day = ymd(dayFromNow(0));
    const iso = toIsoCalendarDate(day);
    expect(formatSchedule({ startDate: iso, startAt: null, dueDate: iso, dueAt: null })).toBe(
      'Today',
    );
    expect(
      formatSchedule({
        startDate: iso,
        startAt: toInstant(day, '09:00'),
        dueDate: iso,
        dueAt: toInstant(day, '15:00'),
      }),
    ).toBe('Today, 9:00 AM – 3:00 PM');
  });

  it('falls back to the due alone without a start', () => {
    expect(
      formatSchedule({ startDate: null, startAt: null, dueDate: isoDay(0), dueAt: null }),
    ).toBe('Today');
  });
});

describe('isOverdue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 5, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('treats a date-only deadline as late only once its day is over', () => {
    expect(isOverdue({ dueDate: toIsoCalendarDate('2026-09-05'), dueAt: null })).toBe(false);
    expect(isOverdue({ dueDate: toIsoCalendarDate('2026-09-04'), dueAt: null })).toBe(true);
  });

  it('treats a timed deadline as late the moment it passes', () => {
    const day = toIsoCalendarDate('2026-09-05');
    expect(isOverdue({ dueDate: day, dueAt: toInstant('2026-09-05', '11:59') })).toBe(true);
    expect(isOverdue({ dueDate: day, dueAt: toInstant('2026-09-05', '12:01') })).toBe(false);
  });

  it('is never late without a due date', () => {
    expect(isOverdue({ dueDate: null, dueAt: null })).toBe(false);
  });
});
