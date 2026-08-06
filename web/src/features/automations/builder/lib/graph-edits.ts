import { PLACEHOLDER_NODE_TYPE, defaultPosition } from '@coretask/contracts';
import type { AutomationNodeType } from '@coretask/contracts';
import type { AutomationGraphNode } from '@coretask/types';

/**
 * A node as the canvas holds it.
 *
 * Widened by exactly one member: `PLACEHOLDER` is a thing the builder draws and
 * the database has no row for, so it cannot be in the stored type — and the
 * canvas would otherwise have to pretend it is an action.
 */
export type CanvasNode = Omit<AutomationGraphNode, 'type'> & {
  type: AutomationNodeType | 'PLACEHOLDER';
};

/**
 * The edits somebody has made but not saved.
 *
 * Held apart from the server's copy rather than merged into it, so cancelling
 * leaves nothing behind and one save writes the whole canvas. `removed` is a
 * list of ids rather than a filtered array for the same reason — the server's
 * nodes stay untouched until the draft is written.
 */
export interface GraphEdits {
  added: CanvasNode[];
  removed: string[];
  moved: Record<string, { x: number; y: number }>;
  configured: Record<string, Record<string, unknown>>;
}

export const NO_EDITS: GraphEdits = { added: [], removed: [], moved: {}, configured: {} };

export function hasEdits(edits: GraphEdits): boolean {
  return (
    edits.added.length > 0 ||
    edits.removed.length > 0 ||
    Object.keys(edits.moved).length > 0 ||
    Object.keys(edits.configured).length > 0
  );
}

/** The server's nodes with the unsaved edits laid over them. */
export function applyEdits(serverNodes: readonly CanvasNode[], edits: GraphEdits): CanvasNode[] {
  const removed = new Set(edits.removed);

  const kept = serverNodes
    .filter((node) => !removed.has(node.id))
    .map((node) => ({
      ...node,
      position: edits.moved[node.id] ?? node.position,
      configuration: edits.configured[node.id] ?? node.configuration,
    }));

  const added = edits.added
    .filter((node) => !removed.has(node.id))
    .map((node) => ({
      ...node,
      position: edits.moved[node.id] ?? node.position,
      configuration: edits.configured[node.id] ?? node.configuration,
    }));

  /*
   * A node whose parent was removed is re-parented rather than dropped.
   *
   * Deleting a step in the middle of a rule should close the gap, not silently
   * take everything after it — which is what filtering alone would do, and the
   * kind of loss somebody only notices after publishing.
   */
  return reconnect([...kept, ...added], removed, serverNodes, edits.added);
}

function reconnect(
  nodes: CanvasNode[],
  removed: Set<string>,
  serverNodes: readonly CanvasNode[],
  added: readonly CanvasNode[],
): CanvasNode[] {
  if (removed.size === 0) return nodes;

  const parentOf = new Map<string, string | null>(
    [...serverNodes, ...added].map((node) => [node.id, node.parentId]),
  );

  const survivingAncestor = (parentId: string | null): string | null => {
    let current = parentId;
    const seen = new Set<string>();

    while (current !== null && removed.has(current)) {
      if (seen.has(current)) return null;
      seen.add(current);
      current = parentOf.get(current) ?? null;
    }

    return current;
  };

  return nodes.map((node) =>
    node.parentId && removed.has(node.parentId)
      ? { ...node, parentId: survivingAncestor(node.parentId) }
      : node,
  );
}

/**
 * The "+ Do this…" the canvas shows when a rule has no action yet.
 *
 * Derived, never stored. A placeholder is the *absence* of a step: writing one
 * to the database would give the runner something it cannot perform, and the
 * API refuses the type for exactly that reason.
 */
export function withPlaceholder(nodes: CanvasNode[]): CanvasNode[] {
  if (nodes.some((node) => node.type === 'ACTION')) return nodes;

  const last = lastOnMainPath(nodes);
  if (!last) return nodes;

  return [
    ...nodes,
    {
      id: 'placeholder',
      type: PLACEHOLDER_NODE_TYPE,
      subtype: 'ACTION',
      configuration: {},
      position: defaultPosition(columnOf(last, nodes) + 1),
      parentId: last.id,
      branchKey: null,
      order: nodes.length,
    },
  ];
}

/** The deepest node with nothing following it — where a new step attaches. */
export function lastOnMainPath(nodes: readonly CanvasNode[]): CanvasNode | null {
  const hasChild = new Set(nodes.map((node) => node.parentId).filter(Boolean) as string[]);
  const leaves = nodes.filter((node) => !hasChild.has(node.id));

  // The last leaf in order, so adding twice appends rather than forking.
  return leaves.sort((a, b) => a.order - b.order)[leaves.length - 1] ?? null;
}

/** How many steps deep a node sits, for placing the next one beside it. */
function columnOf(node: CanvasNode, nodes: readonly CanvasNode[]): number {
  const parentOf = new Map(nodes.map((entry) => [entry.id, entry.parentId]));

  let depth = 0;
  let current = node.parentId;
  const seen = new Set<string>([node.id]);

  while (current !== null && !seen.has(current)) {
    seen.add(current);
    depth += 1;
    current = parentOf.get(current) ?? null;
  }

  return depth;
}

/** A new step, attached to the end of the rule. */
export function makeNode(
  type: AutomationNodeType,
  subtype: string,
  nodes: readonly CanvasNode[],
): CanvasNode {
  const parent = lastOnMainPath(nodes);

  return {
    // Prefixed so it is obvious in a payload that this id has never been to the
    // database — the API maps it to a real one and never trusts it as a key.
    id: `new-${crypto.randomUUID()}`,
    type,
    subtype,
    configuration: {},
    position: defaultPosition(parent ? columnOf(parent, nodes) + 1 : 0),
    parentId: parent?.id ?? null,
    branchKey: null,
    order: nodes.length,
  };
}
