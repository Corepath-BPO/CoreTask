import { BranchKey, GRAPH_LAYOUT } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import type { CanvasNode } from './graph-edits';
import { layoutGraph } from './layout';

const node = (
  id: string,
  type: CanvasNode['type'],
  parentId: string | null,
  branchKey: string | null = null,
  order = 0,
): CanvasNode => ({
  id,
  type,
  subtype: 'X',
  configuration: {},
  position: { x: 0, y: 0 },
  parentId,
  branchKey,
  order,
});

/** Which column and line a node landed on, rather than its pixel position. */
const cell = (position: { x: number; y: number }) => ({
  column: Math.round(
    (position.x - GRAPH_LAYOUT.ORIGIN_X) / (GRAPH_LAYOUT.NODE_WIDTH + GRAPH_LAYOUT.COLUMN_GAP),
  ),
  row: Math.round((position.y - GRAPH_LAYOUT.ORIGIN_Y) / GRAPH_LAYOUT.BRANCH_GAP),
});

const at = (map: Map<string, { x: number; y: number }>, id: string) => cell(map.get(id)!);

describe('layoutGraph', () => {
  it('runs a plain rule left to right on one line', () => {
    const placed = layoutGraph([
      node('t', 'TRIGGER', null),
      node('c', 'CONDITION', 't'),
      node('a', 'ACTION', 'c'),
    ]);

    expect(at(placed, 't')).toEqual({ column: 0, row: 0 });
    expect(at(placed, 'c')).toEqual({ column: 1, row: 0 });
    expect(at(placed, 'a')).toEqual({ column: 2, row: 0 });
  });

  it('puts a split’s matching arm beside it and its otherwise on the next line', () => {
    const placed = layoutGraph([
      node('t', 'TRIGGER', null),
      node('b', 'BRANCH', 't'),
      node('yes', 'ACTION', 'b', BranchKey.MATCH),
      node('no', 'ACTION', 'b', BranchKey.ELSE),
    ]);

    expect(at(placed, 'b')).toEqual({ column: 1, row: 0 });
    expect(at(placed, 'yes')).toEqual({ column: 2, row: 0 });
    expect(at(placed, 'no')).toEqual({ column: 1, row: 1 });
  });

  it('stacks an else-if chain in one column rather than a staircase', () => {
    /*
     * The layout this exists for. Nesting each split inside the previous one's
     * otherwise arm is what an else-if *is*, and drawing it by depth would march
     * the fourth question four columns off the right-hand edge.
     */
    const placed = layoutGraph([
      node('t', 'TRIGGER', null),
      node('b1', 'BRANCH', 't'),
      node('a1', 'ACTION', 'b1', BranchKey.MATCH),
      node('b2', 'BRANCH', 'b1', BranchKey.ELSE),
      node('a2', 'ACTION', 'b2', BranchKey.MATCH),
      node('b3', 'BRANCH', 'b2', BranchKey.ELSE),
      node('a3', 'ACTION', 'b3', BranchKey.MATCH),
    ]);

    // Every question in the same column, one line apart.
    expect(at(placed, 'b1')).toEqual({ column: 1, row: 0 });
    expect(at(placed, 'b2')).toEqual({ column: 1, row: 1 });
    expect(at(placed, 'b3')).toEqual({ column: 1, row: 2 });

    // Every answer beside the question it answers.
    expect(at(placed, 'a1')).toEqual({ column: 2, row: 0 });
    expect(at(placed, 'a2')).toEqual({ column: 2, row: 1 });
    expect(at(placed, 'a3')).toEqual({ column: 2, row: 2 });
  });

  it('gives every branch row a line of its own, with its actions beside it', () => {
    /*
     * The shape the rule builder actually makes now: branches are rows hanging
     * off the trigger, not arms of a split. Read down the column for the
     * questions and across for what each one does.
     */
    const placed = layoutGraph([
      node('t', 'TRIGGER', null, null, 0),
      node('r1', 'CONDITION', 't', null, 1),
      node('a1', 'ACTION', 'r1', null, 2),
      node('r2', 'CONDITION', 't', null, 3),
      node('a2', 'ACTION', 'r2', null, 4),
      node('r3', 'CONDITION', 't', null, 5),
      node('a3', 'ACTION', 'r3', null, 6),
    ]);

    expect(at(placed, 'r1')).toEqual({ column: 1, row: 0 });
    expect(at(placed, 'r2')).toEqual({ column: 1, row: 1 });
    expect(at(placed, 'r3')).toEqual({ column: 1, row: 2 });

    expect(at(placed, 'a1')).toEqual({ column: 2, row: 0 });
    expect(at(placed, 'a2')).toEqual({ column: 2, row: 1 });
    expect(at(placed, 'a3')).toEqual({ column: 2, row: 2 });
  });

  it('never puts two steps in the same place', () => {
    const placed = layoutGraph([
      node('t', 'TRIGGER', null),
      node('b1', 'BRANCH', 't'),
      node('b2', 'BRANCH', 'b1', BranchKey.ELSE),
      node('x', 'ACTION', 'b1', BranchKey.MATCH),
      node('y', 'ACTION', 'b2', BranchKey.MATCH),
      node('z', 'ACTION', 'b2', BranchKey.ELSE),
    ]);

    const seen = [...placed.values()].map((position) => `${position.x},${position.y}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('places a step whose parent is missing instead of stacking it on the origin', () => {
    // A broken rule the validator will refuse — but it has to be *visible* as
    // broken, and every orphan drawn at the origin looks like a rendering fault.
    const placed = layoutGraph([node('t', 'TRIGGER', null), node('orphan', 'ACTION', 'gone')]);

    expect(placed.has('orphan')).toBe(true);
    expect(at(placed, 'orphan')).not.toEqual(at(placed, 't'));
  });

  it('survives a cycle rather than recursing forever', () => {
    const placed = layoutGraph([
      node('a', 'ACTION', 'b'),
      node('b', 'ACTION', 'a'),
      node('t', 'TRIGGER', null),
    ]);

    expect(placed.size).toBe(3);
  });
});
