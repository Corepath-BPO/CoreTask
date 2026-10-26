import { BranchKey, defaultPosition } from '@coretask/contracts';

import type { CanvasNode } from './graph-edits';

/** How deep a chain may be before this stops walking. A cycle, by then. */
const MAX_DEPTH = 100;

/**
 * Where every step sits, worked out from the rule rather than remembered.
 *
 * A rule's shape *is* its meaning — what follows what, and which side of a
 * split something is on — so the drawing has to follow the structure or it
 * describes a different rule than the one that will run. Stored coordinates
 * cannot do that: insert a step in the middle and every position after it is
 * describing where things used to be.
 *
 * The arrangement is the one an if/else-if chain wants:
 *
 *     When ─┬─ Check if ──── Do this
 *           ├─ Otherwise if ─ Do this
 *           └─ Otherwise ──── Do this
 *
 * Each split's matching arm continues to the right on its own line, and its
 * "otherwise" arm drops to the next line in the same column — which is what
 * puts every condition under the one before it and every action beside its own
 * condition. Read down the column for the questions, across for the answers.
 */
export function layoutGraph(nodes: readonly CanvasNode[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const childrenOf = new Map<string, CanvasNode[]>();

  for (const node of nodes) {
    if (node.parentId === null) continue;
    childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node]);
  }

  const byOrder = (a: CanvasNode, b: CanvasNode) => a.order - b.order;

  /*
   * The next free line.
   *
   * Held across the whole walk rather than per branch: two splits in the same
   * rule must not both claim line 1, and the only way to guarantee that is one
   * counter that never goes backwards.
   */
  let nextRow = 0;

  const place = (node: CanvasNode, column: number, row: number, depth: number): void => {
    if (depth > MAX_DEPTH || positions.has(node.id)) return;

    positions.set(node.id, defaultPosition(column, row));
    nextRow = Math.max(nextRow, row);

    const children = [...(childrenOf.get(node.id) ?? [])].sort(byOrder);

    if (node.type !== 'BRANCH') {
      // A plain step continues to the right. More than one child here is not a
      // shape the builder makes, but a hand-written rule could; each extra one
      // takes its own line so nothing is drawn on top of anything else.
      children.forEach((child, index) => {
        place(child, column + 1, index === 0 ? row : (nextRow += 1), depth + 1);
      });

      return;
    }

    // The matching arm carries on beside the question it answers.
    for (const child of children.filter((entry) => entry.branchKey !== BranchKey.ELSE)) {
      place(child, column + 1, row, depth + 1);
    }

    /*
     * And "otherwise" drops a line, staying in this column.
     *
     * This is the whole trick: an else-if is not a fork into the distance, it is
     * the next question in a list. Keeping it in the same column is what makes a
     * chain of them read as one list rather than as a staircase marching off the
     * right-hand edge.
     */
    for (const child of children.filter((entry) => entry.branchKey === BranchKey.ELSE)) {
      place(child, column, (nextRow += 1), depth + 1);
    }
  };

  const roots = nodes.filter((node) => node.parentId === null).sort(byOrder);

  roots.forEach((root, index) => {
    place(root, 0, index === 0 ? 0 : (nextRow += 1), 0);
  });

  /*
   * Anything the walk could not reach still gets a place.
   *
   * A node whose parent is missing is a broken rule, and the validator says so
   * — but leaving it unpositioned would stack it at the origin under the
   * trigger, which looks like a drawing bug rather than the thing it is.
   */
  for (const node of nodes) {
    if (!positions.has(node.id)) {
      positions.set(node.id, defaultPosition(0, (nextRow += 1)));
    }
  }

  return positions;
}
