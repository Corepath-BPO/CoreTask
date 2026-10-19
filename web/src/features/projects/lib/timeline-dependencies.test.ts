import { describe, expect, it } from 'vitest';

import { dependencyPaths, type BarBox } from './timeline-dependencies';

const boxes = new Map<string, BarBox>([
  ['design', { left: 100, right: 200, y: 18 }],
  ['build', { left: 260, right: 400, y: 54 }],
  ['test', { left: 150, right: 220, y: 90 }],
]);

describe('dependencyPaths', () => {
  it('runs from the blocker’s end to the waiting task’s start', () => {
    const [path] = dependencyPaths(
      [{ id: 'e-1', blockingId: 'design', blockedId: 'build' }],
      boxes,
      36,
    );
    expect(path).toEqual({ id: 'e-1', d: 'M 200 18 H 208 V 54 H 260', conflict: false });
  });

  it('doubles back, and marks a conflict, when the waiting task starts too early', () => {
    const [path] = dependencyPaths(
      [{ id: 'e-2', blockingId: 'build', blockedId: 'test' }],
      boxes,
      36,
    );
    expect(path).toEqual({
      id: 'e-2',
      d: 'M 400 54 H 408 V 72 H 142 V 90 H 150',
      conflict: true,
    });
  });

  it('leaves out an edge whose other end is not drawn', () => {
    expect(
      dependencyPaths([{ id: 'e-3', blockingId: 'design', blockedId: 'elsewhere' }], boxes, 36),
    ).toEqual([]);
  });
});
