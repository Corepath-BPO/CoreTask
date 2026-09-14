import { initialSchedule, resolveSchedule, toCalendarDate } from './schedule.util';

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('toCalendarDate', () => {
  it('keeps only the UTC date, at midnight', () => {
    expect(toCalendarDate('2026-09-05T23:59:59.000Z').toISOString()).toBe(
      '2026-09-05T00:00:00.000Z',
    );
    expect(toCalendarDate('2026-09-05T00:00:00.000Z').toISOString()).toBe(
      '2026-09-05T00:00:00.000Z',
    );
  });
});

describe('resolveSchedule', () => {
  const none = { date: null, at: null };

  it('touches nothing when neither half was mentioned', () => {
    expect(resolveSchedule({ date: day('2026-09-05'), at: null }, {}, 'due')).toEqual({});
  });

  it('normalises a date to UTC midnight, with no time', () => {
    expect(resolveSchedule(none, { date: '2026-09-05T17:30:00.000Z' }, 'due')).toEqual({
      date: day('2026-09-05'),
      at: null,
    });
  });

  it('stores the instant beside the date when a time is chosen', () => {
    expect(
      resolveSchedule(
        none,
        { date: '2026-09-05T00:00:00.000Z', at: '2026-09-05T20:00:00.000Z' },
        'due',
      ),
    ).toEqual({ date: day('2026-09-05'), at: new Date('2026-09-05T20:00:00.000Z') });
  });

  it('clears the time along with the date', () => {
    expect(
      resolveSchedule(
        { date: day('2026-09-05'), at: new Date('2026-09-05T20:00:00.000Z') },
        { date: null },
        'due',
      ),
    ).toEqual({ date: null, at: null });
  });

  it('refuses a time on no date rather than dropping it', () => {
    expect(() => resolveSchedule(none, { at: '2026-09-05T20:00:00.000Z' }, 'due')).toThrow(
      'A due time needs a due date.',
    );
  });

  it('carries the time of day across when only the date moves', () => {
    expect(
      resolveSchedule(
        { date: day('2026-09-05'), at: new Date('2026-09-05T20:00:00.000Z') },
        { date: '2026-09-08T00:00:00.000Z' },
        'due',
      ),
    ).toEqual({ date: day('2026-09-08'), at: new Date('2026-09-08T20:00:00.000Z') });
  });

  it('lets the time be removed while the date stays', () => {
    expect(
      resolveSchedule(
        { date: day('2026-09-05'), at: new Date('2026-09-05T20:00:00.000Z') },
        { at: null },
        'due',
      ),
    ).toEqual({ date: day('2026-09-05'), at: null });
  });

  it('lets a time be added to an existing date', () => {
    expect(
      resolveSchedule(
        { date: day('2026-09-05'), at: null },
        { at: '2026-09-05T14:00:00.000Z' },
        'due',
      ),
    ).toEqual({ date: day('2026-09-05'), at: new Date('2026-09-05T14:00:00.000Z') });
  });
});

describe('initialSchedule', () => {
  it('is the pair a new record starts with', () => {
    expect(initialSchedule({}, 'start')).toEqual({ date: null, at: null });
    expect(initialSchedule({ date: '2026-01-02T10:00:00.000Z' }, 'start')).toEqual({
      date: day('2026-01-02'),
      at: null,
    });
  });
});
