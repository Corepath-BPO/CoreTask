import { wouldCloseLoop } from './dependency-graph';

/** `waitsOn` over a fixed edge list: [blocked, blocking]. */
function graph(edges: [string, string][]) {
  let calls = 0;
  const lookup = (ids: string[]) => {
    calls += 1;
    const result = new Map<string, string[]>();
    for (const [blocked, blocking] of edges) {
      if (ids.includes(blocked)) result.set(blocked, [...(result.get(blocked) ?? []), blocking]);
    }
    return Promise.resolve(result);
  };
  return { lookup, calls: () => calls };
}

describe('wouldCloseLoop', () => {
  it('refuses a task waiting on itself', async () => {
    expect(await wouldCloseLoop('a', 'a', graph([]).lookup)).toBe(true);
  });

  it('refuses the direct reverse of an existing edge', async () => {
    // b already waits on a; a waiting on b would be a ring of two.
    expect(await wouldCloseLoop('a', 'b', graph([['b', 'a']]).lookup)).toBe(true);
  });

  it('refuses a ring through several tasks', async () => {
    const edges: [string, string][] = [
      ['b', 'c'],
      ['c', 'd'],
      ['d', 'a'],
    ];
    expect(await wouldCloseLoop('a', 'b', graph(edges).lookup)).toBe(true);
  });

  it('allows a diamond, which is not a loop', async () => {
    // a → b → d and a → c → d: two paths to d, no way back to a.
    const edges: [string, string][] = [
      ['a', 'c'],
      ['b', 'd'],
      ['c', 'd'],
    ];
    expect(await wouldCloseLoop('a', 'b', graph(edges).lookup)).toBe(false);
  });

  it('terminates on an existing cycle elsewhere and asks once per level', async () => {
    const edges: [string, string][] = [
      ['b', 'c'],
      ['c', 'b'],
    ];
    const g = graph(edges);
    expect(await wouldCloseLoop('a', 'b', g.lookup)).toBe(false);
    expect(g.calls()).toBeLessThanOrEqual(3);
  });
});
