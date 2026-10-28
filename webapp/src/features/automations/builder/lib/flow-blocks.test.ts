import { FALLBACK_CONFIG_KEY } from '@coretask/contracts';
import { describe, expect, it } from 'vitest';

import { FLOW_CARD_WIDTH, FLOW_COLUMN_GAP, flowBlocks, flowLayout } from './flow-blocks';
import type { CanvasNode } from './graph-edits';

const node = (
  id: string,
  type: CanvasNode['type'],
  parentId: string | null,
  order = 0,
  configuration: Record<string, unknown> = {},
): CanvasNode => ({
  id,
  type,
  subtype:
    type === 'TRIGGER'
      ? 'TASK_CREATED'
      : type === 'ACTION'
        ? 'MOVE_TO_SECTION'
        : 'FIELD_COMPARISON',
  configuration,
  position: { x: 0, y: 0 },
  parentId,
  branchKey: null,
  order,
});

/** Status is changed: To Do → move + set Started; In Progress → move; otherwise → move. */
const threePaths = (): CanvasNode[] => [
  node('t', 'TRIGGER', null),
  // The fallback is stored first, and still reads last.
  node('f', 'CONDITION', 't', 0, { [FALLBACK_CONFIG_KEY]: true }),
  node('r1', 'CONDITION', 't', 1),
  node('r2', 'CONDITION', 't', 2),
  node('r1b', 'CONDITION', 'r1'),
  node('a1', 'ACTION', 'r1b'),
  node('a2', 'ACTION', 'a1'),
  node('a3', 'ACTION', 'r2'),
  node('a4', 'ACTION', 'f'),
];

const shape = (nodes: CanvasNode[]) =>
  flowBlocks(nodes).map((block) => [
    block.kind,
    block.pathLabel ?? '',
    block.column,
    block.nodeIds,
  ]);

describe('flowBlocks', () => {
  it('draws the trigger, then the paths side by side, each with its own Task card', () => {
    expect(shape(threePaths())).toEqual([
      ['TRIGGER', '', 0, ['t']],
      // A path's checks stay together on its card.
      ['PATH', 'Check if', 0, ['r1', 'r1b']],
      ['TASK', '', 0, ['a1', 'a2']],
      ['PATH', 'Else if', 1, ['r2']],
      ['TASK', '', 1, ['a3']],
      ['PATH', 'Otherwise', 2, ['f']],
      ['TASK', '', 2, ['a4']],
    ]);
  });

  it('hangs a Task card straight under the trigger when there are no paths', () => {
    const nodes = [
      node('t', 'TRIGGER', null),
      node('a1', 'ACTION', 't'),
      node('a2', 'ACTION', 'a1'),
    ];
    expect(shape(nodes)).toEqual([
      ['TRIGGER', '', 0, ['t']],
      ['TASK', '', 0, ['a1', 'a2']],
    ]);
  });

  it('keeps a step being chosen in its Task card, and a later check on a card of its own', () => {
    const nodes = [
      node('t', 'TRIGGER', null),
      node('a1', 'ACTION', 't'),
      node('c', 'CONDITION', 'a1'),
      node('p', 'PLACEHOLDER', 'c'),
    ];
    expect(shape(nodes)).toEqual([
      ['TRIGGER', '', 0, ['t']],
      ['TASK', '', 0, ['a1']],
      ['CHECK', '', 0, ['c']],
      ['TASK', '', 0, ['p']],
    ]);
  });

  it('puts the add control under the last card of each column only', () => {
    const ends = flowBlocks(threePaths()).map((block) => [block.id, block.endsColumn]);
    expect(ends).toEqual([
      ['block:t', false],
      ['block:r1', false],
      ['block:a1', true],
      ['block:r2', false],
      ['block:a3', true],
      ['block:f', false],
      ['block:a4', true],
    ]);
  });

  it('still draws a step whose parent is missing', () => {
    const nodes = [node('t', 'TRIGGER', null), node('lost', 'ACTION', 'gone')];
    expect(shape(nodes)).toEqual([
      ['TRIGGER', '', 0, ['t']],
      ['TASK', '', 1, ['lost']],
    ]);
  });
});

describe('flowLayout', () => {
  it('numbers the trigger and each action, column by column', () => {
    const { numbers } = flowLayout(threePaths());
    expect(Object.fromEntries(numbers)).toEqual({ t: 1, a1: 2, a2: 3, a3: 4, a4: 5 });
  });

  it('stacks a column top to bottom and spaces the columns by a card and a gap', () => {
    const { positions } = flowLayout(threePaths(), {
      heights: new Map([
        ['block:t', 100],
        ['block:r1', 80],
      ]),
    });
    const at = (id: string) => positions.get(id);

    expect(at('block:t')).toEqual({ x: 0, y: 0 });
    // Every path starts the same distance under the trigger.
    expect(at('block:r1')?.y).toBe(at('block:r2')?.y);
    expect(at('block:r2')?.x).toBe(FLOW_CARD_WIDTH + FLOW_COLUMN_GAP);
    // A card sits under the measured height of the one above it.
    expect((at('block:a1')?.y ?? 0) - (at('block:r1')?.y ?? 0)).toBeGreaterThanOrEqual(80);
  });
});
