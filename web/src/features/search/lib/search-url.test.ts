import { describe, expect, it } from 'vitest';

import { filtersFromParams, paramsFromFilters, validateSearchParams } from './search-url';

const P = '01a1224e-60f8-78f3-a8ac-ec92e54bb663';

describe('search params', () => {
  it('round-trips filters through the address bar', () => {
    const filters = {
      text: 'leak',
      assigneeIds: ['me', 'none'],
      projectIds: [P],
      completion: 'COMPLETED' as const,
      due: 'OVERDUE' as const,
      sort: 'TITLE' as const,
    };
    const params = paramsFromFilters(filters);
    expect(params).toEqual({
      q: 'leak',
      assignee: 'me,none',
      project: P,
      status: 'COMPLETED',
      due: 'OVERDUE',
      sort: 'TITLE',
    });
    expect(filtersFromParams(params)).toEqual(filters);
  });

  it('keeps only strings from the route, and only sense from those', () => {
    expect(validateSearchParams({ q: 'x', task: 7, due: '', saved: 'abc' })).toEqual({
      q: 'x',
      saved: 'abc',
    });
    expect(filtersFromParams({ due: 'WHENEVER', assignee: 'robert,me' })).toEqual({
      assigneeIds: ['me'],
    });
  });
});
