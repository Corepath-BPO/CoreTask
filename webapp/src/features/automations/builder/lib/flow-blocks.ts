import { isFallbackBranch } from '@coretask/contracts';

import type { CanvasNode } from './graph-edits';

/**
 * What the canvas draws: the rule's steps gathered into cards, the way the
 * Asana teams moving to CoreTask read their rules.
 *
 *     Tasks in Leasing ─ 1. Status is changed
 *       ├─ Check if ───── Else if ───── Otherwise
 *       │   Status is To Do   Status is In Progress
 *       ├─ Task           Task           Task
 *       │   2. Move to To Do  4. Move to …   5. …
 *       │   3. Set Started
 *
 * - **Trigger card:** the trigger.
 * - **Path cards:** the trigger's condition rows, side by side in their order,
 *   each with the checks that follow it.
 * - **Task card:** a run of actions.
 * - **Check card:** a check that comes after an action, which only a hand-built
 *   rule has.
 *
 * Nothing about the rule changes; this is only how it is grouped on screen.
 * Every line still is, and selects, its own step. See
 * `docs/architecture/automation-builder-layout.md`.
 */
export type FlowBlockKind = 'TRIGGER' | 'PATH' | 'CHECK' | 'TASK';

export interface FlowBlock {
  /** Stable while the block's first step is: the canvas keys cards by it. */
  id: string;
  kind: FlowBlockKind;
  /** The steps the card shows, in the order they run. */
  nodeIds: string[];
  /** The card this one hangs under; null for the trigger. */
  parentId: string | null;
  /** Which column it stands in, counted from the left. */
  column: number;
  /** For a path: Check if, Else if or Otherwise. */
  pathLabel?: 'Check if' | 'Else if' | 'Otherwise';
  /** For a path: its place among the paths, from 0. */
  pathIndex?: number;
  /** True for the last card of a column: the one the + to add a step hangs under. */
  endsColumn: boolean;
}

export interface FlowLayout {
  blocks: FlowBlock[];
  /** Step numbers, as the cards show them: the trigger and each action. */
  numbers: Map<string, number>;
  /** Top-left corner of each card, by block id. */
  positions: Map<string, { x: number; y: number }>;
}

/** Card width, and the space between columns and between cards in a column. */
export const FLOW_CARD_WIDTH = 300;
export const FLOW_COLUMN_GAP = 56;
export const FLOW_ROW_GAP = 56;

/** How deep a chain may be before this stops walking. A cycle, by then. */
const MAX_DEPTH = 200;

/**
 * A card's height before it is drawn, from what is in it.
 *
 * Measured heights replace these once the cards are on screen (see the canvas),
 * so these only have to be close: they decide the first frame, and a card that
 * wraps a long summary simply pushes the cards under it down on the next one.
 */
export function estimatedHeight(block: FlowBlock, collapsed: boolean): number {
  if (collapsed) return 52;
  const lines = block.nodeIds.length;
  switch (block.kind) {
    case 'TRIGGER':
      return 92;
    case 'PATH':
    case 'CHECK':
      return 44 + 30 * lines;
    case 'TASK':
      return 40 + 56 * lines;
  }
}

/**
 * The cards, their columns and where each one sits.
 *
 * `heights` overrides `estimatedHeight` for cards already measured.
 */
export function flowLayout(
  nodes: readonly CanvasNode[],
  options: { collapsed?: boolean; heights?: ReadonlyMap<string, number> } = {},
): FlowLayout {
  const blocks = flowBlocks(nodes);
  const numbers = stepNumbers(nodes, blocks);
  const positions = new Map<string, { x: number; y: number }>();
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const height = (block: FlowBlock) =>
    options.heights?.get(block.id) ?? estimatedHeight(block, options.collapsed ?? false);

  // Blocks come out of `flowBlocks` parents first, so a card's parent is always
  // placed before it.
  for (const block of blocks) {
    const parent = block.parentId ? byId.get(block.parentId) : undefined;
    const parentAt = parent ? positions.get(parent.id) : undefined;
    const y = parent && parentAt ? parentAt.y + height(parent) + FLOW_ROW_GAP : 0;
    positions.set(block.id, { x: block.column * (FLOW_CARD_WIDTH + FLOW_COLUMN_GAP), y });
  }

  return { blocks, numbers, positions };
}

/** The rule's steps gathered into cards, parents before children. */
export function flowBlocks(nodes: readonly CanvasNode[]): FlowBlock[] {
  if (nodes.length === 0) return [];

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenOf = new Map<string, CanvasNode[]>();
  for (const node of nodes) {
    if (node.parentId === null || !byId.has(node.parentId)) continue;
    childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node]);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.order - b.order);
  const children = (id: string) => childrenOf.get(id) ?? [];

  const blocks: FlowBlock[] = [];
  const seen = new Set<string>();
  let nextColumn = 0;

  const trigger = nodes.find((node) => node.type === 'TRIGGER') ?? null;
  const rows = trigger ? children(trigger.id).filter((node) => node.type === 'CONDITION') : [];
  // The fallback runs when nothing above it held, so it reads last, whatever
  // order it was stored in.
  const orderedRows = [
    ...rows.filter((row) => !isFallbackBranch(row.configuration)),
    ...rows.filter((row) => isFallbackBranch(row.configuration)),
  ];

  /** Takes the next step into the card while it is the same kind and nothing forks. */
  const gather = (first: CanvasNode, belongs: (node: CanvasNode) => boolean): CanvasNode[] => {
    const run = [first];
    let current = first;
    for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
      const next = children(current.id);
      const only = next.length === 1 ? next[0] : undefined;
      if (!only || seen.has(only.id) || !belongs(only)) break;
      run.push(only);
      current = only;
    }
    return run;
  };

  const isAction = (node: CanvasNode) => node.type === 'ACTION' || node.type === 'PLACEHOLDER';
  const isCheck = (node: CanvasNode) => node.type === 'CONDITION' || node.type === 'BRANCH';

  /** One card from `first`, then whatever hangs under its last step. */
  const walk = (first: CanvasNode, parentId: string | null, column: number, depth: number) => {
    if (depth > MAX_DEPTH || seen.has(first.id)) return;

    let kind: FlowBlockKind;
    let run: CanvasNode[];
    const block: Partial<FlowBlock> = {};

    if (first.type === 'TRIGGER') {
      kind = 'TRIGGER';
      run = [first];
    } else if (isAction(first)) {
      kind = 'TASK';
      run = gather(first, isAction);
    } else if (first.parentId === trigger?.id && first.type === 'CONDITION') {
      kind = 'PATH';
      // A fallback asks nothing, so nothing after it joins it as a check.
      run = isFallbackBranch(first.configuration) ? [first] : gather(first, isCheck);
      const index = orderedRows.findIndex((row) => row.id === first.id);
      block.pathIndex = index;
      block.pathLabel = isFallbackBranch(first.configuration)
        ? 'Otherwise'
        : index === 0
          ? 'Check if'
          : 'Else if';
    } else {
      kind = 'CHECK';
      run = gather(first, isCheck);
    }

    for (const node of run) seen.add(node.id);
    const id = `block:${first.id}`;
    const last = run[run.length - 1] as CanvasNode;
    const own = { id, kind, nodeIds: run.map((node) => node.id), parentId, column, ...block };
    blocks.push({ ...own, endsColumn: false });

    let next = children(last.id).filter((node) => !seen.has(node.id));
    if (kind === 'TRIGGER') {
      // The paths in their reading order, then anything else the trigger leads to.
      next = [
        ...orderedRows.filter((row) => !seen.has(row.id)),
        ...next.filter((node) => node.type !== 'CONDITION'),
      ];
    }

    next.forEach((child, index) => {
      // The first carries on down this column; any other starts one of its own.
      const childColumn = index === 0 ? column : (nextColumn += 1);
      walk(child, id, childColumn, depth + 1);
    });
  };

  if (trigger) walk(trigger, null, 0, 0);

  // Anything the walk could not reach still gets a card, in a column of its own.
  for (const node of nodes) {
    if (!seen.has(node.id) && (node.parentId === null || !byId.has(node.parentId))) {
      walk(node, null, (nextColumn += 1), 0);
    }
  }
  for (const node of nodes) {
    if (!seen.has(node.id)) walk(node, null, (nextColumn += 1), 0);
  }

  // The card nothing hangs under in its own column carries the add control.
  const continued = new Set(
    blocks
      .filter((block) => block.parentId !== null)
      .map((block) => {
        const parent = blocks.find((entry) => entry.id === block.parentId);
        return parent && parent.column === block.column ? parent.id : '';
      }),
  );
  return blocks.map((block) => ({ ...block, endsColumn: !continued.has(block.id) }));
}

/** Step 1 is the trigger; then each action, down each column, columns left to right. */
function stepNumbers(
  nodes: readonly CanvasNode[],
  blocks: readonly FlowBlock[],
): Map<string, number> {
  const types = new Map(nodes.map((node) => [node.id, node.type]));
  const numbers = new Map<string, number>();
  let next = 1;
  for (const block of blocks) {
    if (block.kind !== 'TRIGGER' && block.kind !== 'TASK') continue;
    for (const id of block.nodeIds) {
      if (types.get(id) === 'PLACEHOLDER') continue;
      numbers.set(id, next);
      next += 1;
    }
  }
  return numbers;
}
