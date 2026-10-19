import { describe, expect, it } from 'vitest';

import { DEFAULT_MY_TASKS_RULES, myTasksBucketFor, myTasksRulesOf } from './my-tasks.js';

const base = {
  placed: null,
  placedToday: false,
  dueDate: null,
  completed: false,
  rules: { dueToday: true, dueThisWeek: true },
  today: '2026-10-14',
} as const;

describe('myTasksBucketFor', () => {
  it('moves what is due today, or late, into Do today', () => {
    expect(myTasksBucketFor({ ...base, dueDate: '2026-10-14T00:00:00.000Z' })).toBe('TODAY');
    expect(myTasksBucketFor({ ...base, dueDate: '2026-10-01', placed: 'LATER' })).toBe('TODAY');
  });

  it('moves what is due this week into Do next week, from the waiting sections only', () => {
    expect(myTasksBucketFor({ ...base, dueDate: '2026-10-20' })).toBe('NEXT_WEEK');
    expect(myTasksBucketFor({ ...base, dueDate: '2026-10-20', placed: 'LATER' })).toBe('NEXT_WEEK');
    expect(myTasksBucketFor({ ...base, dueDate: '2026-10-20', placed: 'TODAY' })).toBe('TODAY');
    expect(myTasksBucketFor({ ...base, dueDate: '2026-10-30' })).toBe('RECENTLY_ASSIGNED');
  });

  it('leaves alone what its owner moved today, what is done, and what rules are off for', () => {
    expect(
      myTasksBucketFor({ ...base, dueDate: '2026-10-14', placed: 'LATER', placedToday: true }),
    ).toBe('LATER');
    expect(myTasksBucketFor({ ...base, dueDate: '2026-10-14', completed: true })).toBe(
      'RECENTLY_ASSIGNED',
    );
    expect(
      myTasksBucketFor({
        ...base,
        dueDate: '2026-10-14',
        rules: { dueToday: false, dueThisWeek: false },
      }),
    ).toBe('RECENTLY_ASSIGNED');
  });

  it('fills unset rules with the defaults', () => {
    expect(myTasksRulesOf({})).toEqual(DEFAULT_MY_TASKS_RULES);
    expect(myTasksRulesOf({ dueThisWeek: true })).toEqual({ dueToday: true, dueThisWeek: true });
    expect(myTasksRulesOf(null)).toEqual(DEFAULT_MY_TASKS_RULES);
  });
});
