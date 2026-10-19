import { rankHits, searchRank } from './search-rank';

describe('searchRank', () => {
  it('ranks exact over prefix over word start over substring', () => {
    expect(searchRank('API', 'api')).toBe(4);
    expect(searchRank('API gateway', 'api')).toBe(3);
    expect(searchRank('Public API docs', 'api')).toBe(2);
    expect(searchRank('Rapid prototyping', 'api')).toBe(1);
    expect(searchRank('Nothing here', 'api')).toBe(0);
  });

  it('treats punctuation as a word boundary', () => {
    expect(searchRank('auth/refresh-token rotation', 'token')).toBe(2);
  });

  it('ignores case and surrounding space in the query', () => {
    expect(searchRank('Launch plan', '  LAUNCH ')).toBe(3);
  });
});

describe('rankHits', () => {
  const hits = [
    { id: 'recent-substring', name: 'Rapid prototyping' },
    { id: 'older-prefix', name: 'API gateway' },
    { id: 'oldest-exact', name: 'api' },
  ];

  it('puts the best match first and keeps incoming order for ties', () => {
    const ranked = rankHits(hits, 'api', (hit) => [hit.name], 10).map((hit) => hit.id);
    expect(ranked).toEqual(['oldest-exact', 'older-prefix', 'recent-substring']);
  });

  it('trims to the limit after ranking, not before', () => {
    const ranked = rankHits(hits, 'api', (hit) => [hit.name], 1).map((hit) => hit.id);
    expect(ranked).toEqual(['oldest-exact']);
  });

  it('takes the best of several texts', () => {
    const tickets = [
      { key: 'CORE-1', title: 'Unrelated' },
      { key: 'CORE-12', title: 'core outage' },
    ];
    const ranked = rankHits(tickets, 'core-1', (hit) => [hit.key, hit.title], 10).map(
      (hit) => hit.key,
    );
    expect(ranked).toEqual(['CORE-1', 'CORE-12']);
  });
});
