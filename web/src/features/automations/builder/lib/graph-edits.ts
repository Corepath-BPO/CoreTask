import { BranchKey, PLACEHOLDER_NODE_TYPE, defaultPosition } from '@coretask/contracts';
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
 *
 * There is no `moved` here any more. Where a step sits is worked out from the
 * rule's shape rather than remembered, so a position is a consequence of an
 * edit rather than one of its own — see `layoutGraph`.
 */
export interface GraphEdits {
  added: CanvasNode[];
  removed: string[];
  configured: Record<string, Record<string, unknown>>;
  /**
   * Steps whose *kind* changed — picking the trigger of a new rule, mostly.
   *
   * Separate from `configured` because the two do not travel together: changing
   * what a step is makes its old settings meaningless, so a retype clears them
   * rather than carrying a section id onto a trigger that has no section.
   */
  retyped: Record<string, string>;
  /**
   * Steps whose place in the rule changed — what runs after what.
   *
   * Needed because a step can be added *between* two others, not only at the
   * end: the new step takes the parent, and whatever used to follow that parent
   * now follows the new step. Without this the only possible edit is "append",
   * and a control offering to insert here would be quietly lying about where the
   * step lands.
   */
  reparented: Record<string, { parentId: string | null; branchKey: string | null }>;
}

/**
 * Where the children of `parentId` have to move when a step is inserted.
 *
 * Only the ones on the same arm: inserting into the "otherwise" side of a split
 * must not drag the matching side along with it.
 *
 * `onto` is which arm of the *new* step they land on. It is the main path for
 * an ordinary insertion, and the "otherwise" arm when the new step is another
 * question — because "otherwise if X do A, otherwise do B" means the fallback
 * that was there moves to after the new question, not in front of it.
 */
export function adoptChildren(
  inserted: CanvasNode,
  nodes: readonly CanvasNode[],
  onto: string | null = null,
): GraphEdits['reparented'] {
  const moved: GraphEdits['reparented'] = {};

  for (const node of nodes) {
    if (node.id === inserted.id) continue;
    if (node.parentId !== inserted.parentId) continue;
    if (node.branchKey !== inserted.branchKey) continue;

    moved[node.id] = { parentId: inserted.id, branchKey: onto };
  }

  return moved;
}

export const NO_EDITS: GraphEdits = {
  added: [],
  removed: [],
  configured: {},
  retyped: {},
  reparented: {},
};

export function hasEdits(edits: GraphEdits): boolean {
  return (
    edits.added.length > 0 ||
    edits.removed.length > 0 ||
    Object.keys(edits.configured).length > 0 ||
    Object.keys(edits.retyped).length > 0 ||
    Object.keys(edits.reparented).length > 0
  );
}

/** The server's nodes with the unsaved edits laid over them. */
export function applyEdits(serverNodes: readonly CanvasNode[], edits: GraphEdits): CanvasNode[] {
  const removed = new Set(edits.removed);

  const overlay = (node: CanvasNode): CanvasNode => ({
    ...node,
    subtype: edits.retyped[node.id] ?? node.subtype,
    configuration: edits.configured[node.id] ?? node.configuration,
    ...(edits.reparented[node.id] ?? {}),
  });

  const kept = serverNodes.filter((node) => !removed.has(node.id)).map(overlay);
  const added = edits.added.filter((node) => !removed.has(node.id)).map(overlay);

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
  const placeholders: CanvasNode[] = [];

  const make = (parent: CanvasNode, arm: string | null, row: number): CanvasNode => ({
    // The id encodes where it goes, so choosing an action knows which arm it
    // lands on without the page tracking a separate selection.
    id: placeholderId(parent.id, arm),
    type: PLACEHOLDER_NODE_TYPE,
    subtype: 'ACTION',
    configuration: {},
    position: defaultPosition(columnOf(parent, nodes) + 1, row),
    parentId: parent.id,
    branchKey: arm,
    order: nodes.length + placeholders.length,
  });

  /*
   * Every arm of a branch gets one, filled or not.
   *
   * A split showing only the path somebody has already built looks like it goes
   * one way. Both arms visible is what makes it read as a choice — and an empty
   * arm is exactly where the next step goes.
   */
  for (const branch of nodes.filter((node) => node.type === 'BRANCH')) {
    const arms = [BranchKey.MATCH, BranchKey.ELSE];

    arms.forEach((arm, index) => {
      const filled = nodes.some((node) => node.parentId === branch.id && node.branchKey === arm);
      if (!filled) placeholders.push(make(branch, arm, index));
    });
  }

  // And one at the end when the rule has no action anywhere, which is what a
  // brand-new rule looks like.
  if (!nodes.some((node) => node.type === 'ACTION')) {
    const last = lastOnMainPath(nodes);

    if (last && last.type !== 'BRANCH') placeholders.push(make(last, null, 0));
  }

  return placeholders.length ? [...nodes, ...placeholders] : nodes;
}

/** Where a placeholder puts what replaces it. */
export function placeholderId(parentId: string, arm: string | null): string {
  return `placeholder:${parentId}:${arm ?? 'main'}`;
}

export function readPlaceholderId(id: string): { parentId: string; arm: string | null } | null {
  if (!id.startsWith('placeholder:')) return null;

  const [, parentId, arm] = id.split(':');
  if (!parentId) return null;

  return { parentId, arm: arm === 'main' ? null : (arm ?? null) };
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

/**
 * The single trigger a rule that does not exist yet starts from.
 *
 * A brand-new rule is drawn from a graph held in the browser, not fetched — it
 * has no id until somebody saves it. Giving it a trigger node straight away is
 * what makes the canvas show a rule taking shape rather than an empty grid with
 * a toolbar above it, and the trigger is the one step every rule must have.
 *
 * `subtype` is empty when nobody has chosen yet, which the validator and the
 * card both treat as "not answered" rather than as a trigger named "".
 */
export function makeTrigger(subtype = '', configuration: Record<string, unknown> = {}): CanvasNode {
  return {
    id: `new-${crypto.randomUUID()}`,
    type: 'TRIGGER',
    subtype,
    configuration,
    position: defaultPosition(0, 0),
    parentId: null,
    branchKey: null,
    order: 0,
  };
}

/**
 * The shape a new rule opens with: a trigger, a check, and a space for an action.
 *
 * Three cards rather than one, because a rule is a sentence — when this happens,
 * if this is true, do this — and starting from a single trigger makes somebody
 * work out the sentence before they can begin writing it. The empty action is
 * the placeholder the canvas derives, so only two are built here.
 *
 * A section fills the check in. Coming from that section's menu means "when a
 * task lands here" was the whole point of the click, and a rule that opens with
 * the answer already written is one somebody can edit rather than compose.
 */
export function makeDefaultNodes(sectionId?: string): CanvasNode[] {
  const trigger = makeTrigger(
    sectionId ? 'TASK_MOVED_TO_SECTION' : '',
    sectionId ? { sectionId } : {},
  );

  const condition = makeNodeUnder('CONDITION', 'FIELD_COMPARISON', trigger.id, null, [trigger]);

  return [
    trigger,
    {
      ...condition,
      configuration: sectionId ? { field: 'sectionId', operator: 'EQUALS', value: sectionId } : {},
    },
  ];
}

/** A new step, attached to the end of the rule. */
export function makeNode(
  type: AutomationNodeType,
  subtype: string,
  nodes: readonly CanvasNode[],
): CanvasNode {
  const parent = lastOnMainPath(nodes);

  return makeNodeUnder(type, subtype, parent?.id ?? null, null, nodes);
}

/** A new step under a named parent — the arm of a branch, usually. */
export function makeNodeUnder(
  type: AutomationNodeType,
  subtype: string,
  parentId: string | null,
  branchKey: string | null,
  nodes: readonly CanvasNode[],
): CanvasNode {
  const parent = nodes.find((node) => node.id === parentId) ?? null;

  return {
    // Prefixed so it is obvious in a payload that this id has never been to the
    // database — the API maps it to a real one and never trusts it as a key.
    id: `new-${crypto.randomUUID()}`,
    type,
    subtype,
    configuration: {},
    position: defaultPosition(
      parent ? columnOf(parent, nodes) + 1 : 0,
      branchKey === BranchKey.ELSE ? 1 : 0,
    ),
    parentId,
    branchKey,
    order: nodes.length,
  };
}

/**
 * A split, attached to the end of the rule.
 *
 * It carries the comparison itself rather than sitting beside a condition —
 * that is what the runner evaluates to choose an arm, so putting it anywhere
 * else would mean two nodes describing one decision.
 */
export function makeBranch(nodes: readonly CanvasNode[]): CanvasNode {
  return makeNode('BRANCH', 'FIELD_COMPARISON', nodes);
}
