import { describe, expect, it } from 'vitest';

import { readTaskSearchFilters, sameTaskSearch } from './saved-searches.js';

const A = '01a1224e-60f8-78f3-a8ac-ec92e54bb663';
const B = '01a12296-7a2d-7ef3-aa54-cdfc64ba7da9';

describe('readTaskSearchFilters', () => {
  it('keeps what it knows, drops the rest, and leaves out empty parts', () => {
    expect(
      readTaskSearchFilters({
        text: '  leak ',
        assigneeIds: ['me', 'none', A, 'robert', A],
        projectIds: [],
        completion: 'INCOMPLETE',
        due: 'ANY',
        sort: 'SIDEWAYS',
        createdByIds: ['none'],
        extra: true,
      }),
    ).toEqual({ text: 'leak', assigneeIds: ['me', 'none', A], completion: 'INCOMPLETE' });
    expect(readTaskSearchFilters(null)).toEqual({});
    expect(readTaskSearchFilters(['x'])).toEqual({});
  });
});

describe('sameTaskSearch', () => {
  it('ignores list order and parts that mean nothing', () => {
    expect(
      sameTaskSearch(
        { projectIds: [A, B], due: 'ANY', completion: 'COMPLETED' },
        { completion: 'COMPLETED', projectIds: [B, A] },
      ),
    ).toBe(true);
    expect(sameTaskSearch({ text: 'a' }, { text: 'b' })).toBe(false);
  });
});
