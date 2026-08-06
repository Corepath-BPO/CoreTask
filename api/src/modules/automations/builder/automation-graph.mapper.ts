import { defaultPosition } from '@coretask/contracts';
import type { AutomationGraph, AutomationGraphNode } from '@coretask/types';
import { deriveEdges } from '@coretask/validation';
import type { AutomationNode } from '@prisma/client';

/**
 * Rows to the shape the canvas draws.
 *
 * There is no conversion here worth the name — the row already *is* the node.
 * What this adds is edges, derived from parentage rather than stored, and a
 * position for rules built before the canvas existed.
 */
export function toGraph(nodes: readonly AutomationNode[]): AutomationGraph {
  const ordered = [...nodes].sort((a, b) => a.position - b.position);
  const placed = ordered.map((node) => toGraphNode(node, ordered));

  return {
    nodes: placed,
    edges: deriveEdges(
      placed.map((node) => ({
        id: node.id,
        type: node.type,
        parentId: node.parentId,
        branchKey: node.branchKey,
        order: node.order,
      })),
    ),
  };
}

function toGraphNode(node: AutomationNode, all: readonly AutomationNode[]): AutomationGraphNode {
  return {
    id: node.id,
    type: node.nodeType,
    subtype: node.subtype,
    configuration: (node.configuration ?? {}) as Record<string, unknown>,
    position: placementFor(node, all),
    parentId: node.parentNodeId,
    branchKey: node.branchKey,
    order: node.position,
  };
}

/**
 * Where a node sits.
 *
 * Stored coordinates win. A rule built in the old stacked form has none — every
 * node sits at (0, 0) — and drawing them all on top of each other would make an
 * existing rule look broken rather than merely un-arranged. So a node at the
 * origin is treated as unplaced and laid out by category: trigger first,
 * conditions next, actions after.
 *
 * The check is `=== 0` on both axes rather than a null test because the columns
 * are non-nullable with a zero default; there is no way to tell "never placed"
 * from "placed at the origin", and the origin is not somewhere a person drags a
 * node to.
 */
function placementFor(
  node: AutomationNode,
  all: readonly AutomationNode[],
): { x: number; y: number } {
  if (node.positionX !== 0 || node.positionY !== 0) {
    return { x: node.positionX, y: node.positionY };
  }

  const column = node.nodeType === 'TRIGGER' ? 0 : node.nodeType === 'CONDITION' ? 1 : 2;

  // Nodes sharing a column stack downwards so a rule with three actions reads
  // as three steps rather than one.
  const row = all
    .filter((other) => other.nodeType === node.nodeType)
    .findIndex((other) => other.id === node.id);

  return defaultPosition(column, Math.max(0, row));
}
