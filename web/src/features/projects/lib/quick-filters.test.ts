import { describe, expect, it } from 'vitest';

import { DEFAULT_VIEW_SETTINGS } from './view-settings';

import { QuickFilter, isQuickFilterActive, toggleQuickFilter } from './quick-filters';

const ME = 'u-me';

describe('quick filters', () => {
  it('turns "Just my tasks" into an assignee condition, and back', () => {
    const on = {
      ...DEFAULT_VIEW_SETTINGS,
      ...toggleQuickFilter(DEFAULT_VIEW_SETTINGS, QuickFilter.MINE, ME),
    };

    expect(on.filters.conditions).toEqual([{ field: 'assigneeId', operator: 'IN', value: [ME] }]);
    expect(isQuickFilterActive(on, QuickFilter.MINE, ME)).toBe(true);

    const off = { ...on, ...toggleQuickFilter(on, QuickFilter.MINE, ME) };
    expect(off.filters.conditions).toEqual([]);
  });

  it('reads "Incomplete" as the showCompleted flag rather than a condition', () => {
    const on = {
      ...DEFAULT_VIEW_SETTINGS,
      ...toggleQuickFilter(DEFAULT_VIEW_SETTINGS, QuickFilter.INCOMPLETE, ME),
    };

    expect(on.showCompleted).toBe(false);
    expect(on.filters.conditions).toEqual([]);
    expect(isQuickFilterActive(on, QuickFilter.INCOMPLETE, ME)).toBe(true);
  });

  it('names the week with tokens the server resolves, so the filter never goes stale', () => {
    const on = {
      ...DEFAULT_VIEW_SETTINGS,
      ...toggleQuickFilter(DEFAULT_VIEW_SETTINGS, QuickFilter.DUE_THIS_WEEK, ME),
    };

    expect(on.filters.conditions).toEqual([
      { field: 'dueDate', operator: 'GREATER_THAN_OR_EQUAL', value: '@startOfWeek' },
      { field: 'dueDate', operator: 'LESS_THAN_OR_EQUAL', value: '@endOfWeek' },
    ]);
  });

  it('swaps one week for the other rather than holding both', () => {
    const thisWeek = {
      ...DEFAULT_VIEW_SETTINGS,
      ...toggleQuickFilter(DEFAULT_VIEW_SETTINGS, QuickFilter.DUE_THIS_WEEK, ME),
    };
    const nextWeek = { ...thisWeek, ...toggleQuickFilter(thisWeek, QuickFilter.DUE_NEXT_WEEK, ME) };

    expect(isQuickFilterActive(nextWeek, QuickFilter.DUE_THIS_WEEK, ME)).toBe(false);
    expect(isQuickFilterActive(nextWeek, QuickFilter.DUE_NEXT_WEEK, ME)).toBe(true);
    expect(nextWeek.filters.conditions).toHaveLength(2);
  });

  it('leaves a condition somebody added by hand alone', () => {
    const hand = {
      ...DEFAULT_VIEW_SETTINGS,
      filters: {
        combinator: 'AND' as const,
        conditions: [{ field: 'title', operator: 'CONTAINS' as const, value: 'x' }],
      },
    };
    const on = { ...hand, ...toggleQuickFilter(hand, QuickFilter.MINE, ME) };
    const off = { ...on, ...toggleQuickFilter(on, QuickFilter.MINE, ME) };

    expect(off.filters.conditions).toEqual(hand.filters.conditions);
  });
});
