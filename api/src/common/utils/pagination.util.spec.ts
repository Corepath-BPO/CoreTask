import { buildPaginationMeta, toSkipTake } from './pagination.util';

describe('toSkipTake', () => {
  it('maps page 1 to no offset', () => {
    expect(toSkipTake({ page: 1, limit: 20 })).toEqual({ skip: 0, take: 20 });
  });

  it('offsets by whole pages', () => {
    expect(toSkipTake({ page: 4, limit: 25 })).toEqual({ skip: 75, take: 25 });
  });
});

describe('buildPaginationMeta', () => {
  it('rounds a partial last page up', () => {
    expect(buildPaginationMeta({ page: 1, limit: 20 }, 137)).toEqual({
      page: 1,
      limit: 20,
      total: 137,
      totalPages: 7,
    });
  });

  it('reports zero pages for an empty result, not one', () => {
    expect(buildPaginationMeta({ page: 1, limit: 20 }, 0).totalPages).toBe(0);
  });

  it('reports a single page when the result fits exactly', () => {
    expect(buildPaginationMeta({ page: 1, limit: 20 }, 20).totalPages).toBe(1);
  });
});
