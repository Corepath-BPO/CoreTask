import { describe, expect, it } from 'vitest';

import { bucketOf, dropDueDate, dueBuckets, dueDatePayload } from './due-buckets';

// Wednesday 14 October 2026, mid-morning local time.
const WEDNESDAY = new Date(2026, 9, 14, 10);

describe('dueBuckets', () => {
  it('splits the calendar into Asana’s headings from today', () => {
    expect(dueBuckets(WEDNESDAY).map((bucket) => [bucket.key, bucket.from, bucket.to])).toEqual([
      ['overdue', null, '2026-10-13'],
      ['today', '2026-10-14', '2026-10-14'],
      ['tomorrow', '2026-10-15', '2026-10-15'],
      ['this-week', '2026-10-16', '2026-10-18'],
      ['next-week', '2026-10-19', '2026-10-25'],
      ['later', '2026-10-26', null],
    ]);
  });

  it('drops a heading with no days in it, and never lets two share a day', () => {
    // Saturday: tomorrow is Sunday, so this week has nothing left.
    const saturday = dueBuckets(new Date(2026, 9, 17, 10));
    expect(saturday.map((bucket) => bucket.key)).not.toContain('this-week');
    expect(saturday.find((bucket) => bucket.key === 'next-week')?.from).toBe('2026-10-19');
    // Sunday: tomorrow is Monday, so next week starts the day after.
    const sunday = dueBuckets(new Date(2026, 9, 18, 10));
    expect(sunday.find((bucket) => bucket.key === 'tomorrow')?.from).toBe('2026-10-19');
    expect(sunday.find((bucket) => bucket.key === 'next-week')?.from).toBe('2026-10-20');
  });

  it('puts a due date under its heading', () => {
    const buckets = dueBuckets(WEDNESDAY);
    expect(bucketOf('2026-10-01T00:00:00.000Z', buckets)).toBe('overdue');
    expect(bucketOf('2026-10-14T00:00:00.000Z', buckets)).toBe('today');
    expect(bucketOf('2026-10-17T00:00:00.000Z', buckets)).toBe('this-week');
    expect(bucketOf('2026-10-21T00:00:00.000Z', buckets)).toBe('next-week');
    expect(bucketOf('2027-02-01T00:00:00.000Z', buckets)).toBe('later');
    expect(bucketOf(null, buckets)).toBeNull();
  });
});

describe('dropDueDate', () => {
  it('gives a day for the headings that name one, and refuses the open ends', () => {
    expect(dropDueDate('today', WEDNESDAY)).toEqual({ ok: true, dueDate: '2026-10-14' });
    expect(dropDueDate('tomorrow', WEDNESDAY)).toEqual({ ok: true, dueDate: '2026-10-15' });
    expect(dropDueDate('this-week', WEDNESDAY)).toEqual({ ok: true, dueDate: '2026-10-16' });
    expect(dropDueDate('next-week', WEDNESDAY)).toEqual({ ok: true, dueDate: '2026-10-19' });
    expect(dropDueDate(null, WEDNESDAY)).toEqual({ ok: true, dueDate: null });
    expect(dropDueDate('overdue', WEDNESDAY).ok).toBe(false);
    expect(dropDueDate('later', WEDNESDAY).ok).toBe(false);
  });
});

describe('dueDatePayload', () => {
  it('moves a due time along with its date', () => {
    expect(
      dueDatePayload(
        { dueDate: '2026-10-14T00:00:00.000Z', dueAt: '2026-10-14T17:30:00.000Z' },
        '2026-10-19',
      ),
    ).toEqual({ dueDate: '2026-10-19T00:00:00.000Z', dueAt: '2026-10-19T17:30:00.000Z' });
    expect(dueDatePayload({ dueDate: null, dueAt: null }, '2026-10-19')).toEqual({
      dueDate: '2026-10-19T00:00:00.000Z',
      dueAt: null,
    });
    expect(dueDatePayload({ dueDate: '2026-10-14T00:00:00.000Z', dueAt: null }, null)).toEqual({
      dueDate: null,
      dueAt: null,
    });
  });
});
