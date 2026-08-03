import { POSITION_MIN_GAP, POSITION_STEP } from '@coretask/contracts';

export interface OrderedItem {
  id: string;
  position: number;
}

export interface PositionPlan {
  /** Position to write for the item being inserted or moved. */
  position: number;
  /**
   * New positions for existing siblings. Empty in the common case; non-empty
   * only when the gap ran out and the list had to be renumbered.
   */
  rebalance: OrderedItem[];
}

/**
 * Where to place an item in a fractionally-ordered list.
 *
 * Ordering is expressed relative to a sibling rather than as a raw number, so a
 * client can never write a position that collides with or sorts oddly against
 * its neighbours. The midpoint rule means an insertion normally rewrites a
 * single row instead of renumbering everything after it.
 *
 * @param siblings  Every item in the list, in any order.
 * @param afterId   `undefined` appends, `null` prepends, otherwise the id to
 *                  sit immediately after.
 * @param movingId  Set when repositioning an existing item, so it is excluded
 *                  from its own neighbour calculation.
 */
export function planPlacement(
  siblings: readonly OrderedItem[],
  afterId: string | null | undefined,
  movingId?: string,
): PositionPlan {
  const ordered = [...siblings].sort(compareByPosition);

  // Moving an item after itself is a no-op, not an error — a drag that ends
  // where it started produces exactly this.
  if (movingId !== undefined && afterId === movingId) {
    const current = ordered.find((item) => item.id === movingId);
    if (current) return { position: current.position, rebalance: [] };
  }

  const others = movingId === undefined ? ordered : ordered.filter((item) => item.id !== movingId);

  // -1 means "before the first item".
  const anchorIndex =
    afterId === undefined
      ? others.length - 1
      : afterId === null
        ? -1
        : others.findIndex((item) => item.id === afterId);

  if (afterId !== undefined && afterId !== null && anchorIndex === -1) {
    throw new Error(`Cannot position after unknown sibling "${afterId}".`);
  }

  const before = anchorIndex >= 0 ? (others[anchorIndex] as OrderedItem).position : null;
  const after =
    anchorIndex + 1 < others.length ? (others[anchorIndex + 1] as OrderedItem).position : null;

  if (before === null && after === null) return { position: POSITION_STEP, rebalance: [] };
  if (before === null) return { position: after! - POSITION_STEP, rebalance: [] };
  if (after === null) return { position: before + POSITION_STEP, rebalance: [] };

  const gap = after - before;

  // Repeated midpoint insertion into the same gap halves it each time, so after
  // roughly fifty drops into one slot the two neighbours become
  // indistinguishable in double precision and ordering silently breaks.
  // Renumbering the whole list is rare and cheap; a corrupted order is not.
  if (gap > POSITION_MIN_GAP) {
    return { position: before + gap / 2, rebalance: [] };
  }

  return rebalanceAround(others, anchorIndex);
}

/** Position for appending to a list, given the positions already used. */
export function appendPosition(siblings: readonly OrderedItem[]): number {
  return planPlacement(siblings, undefined).position;
}

/** Evenly spaced positions for a fresh list, e.g. a project's default sections. */
export function initialPositions(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * POSITION_STEP);
}

/**
 * Renumbers the list at full spacing and returns the slot the new item takes.
 * Only the siblings whose position actually changes are reported.
 */
function rebalanceAround(others: readonly OrderedItem[], anchorIndex: number): PositionPlan {
  const rebalance: OrderedItem[] = [];
  let insertedPosition = POSITION_STEP;
  let slot = 0;

  const take = (): number => {
    slot += 1;
    return slot * POSITION_STEP;
  };

  for (let index = 0; index < others.length; index += 1) {
    const sibling = others[index] as OrderedItem;
    const position = take();

    if (position !== sibling.position) {
      rebalance.push({ id: sibling.id, position });
    }

    if (index === anchorIndex) {
      insertedPosition = take();
    }
  }

  if (anchorIndex === -1) {
    // Prepending: everything shifted up by one slot, so the free slot is the
    // first one. Recompute rather than special-casing inside the loop.
    return {
      position: POSITION_STEP,
      rebalance: others.map((sibling, index) => ({
        id: sibling.id,
        position: (index + 2) * POSITION_STEP,
      })),
    };
  }

  return { position: insertedPosition, rebalance };
}

function compareByPosition(a: OrderedItem, b: OrderedItem): number {
  // Stable tiebreak on id: equal positions are possible after a bad migration
  // or a concurrent write, and an unstable sort would make the list flicker.
  return a.position === b.position ? a.id.localeCompare(b.id) : a.position - b.position;
}
