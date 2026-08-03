import { POSITION_MIN_GAP, POSITION_STEP } from '@coretask/contracts';

import { appendPosition, initialPositions, planPlacement, type OrderedItem } from './position.util';

/** Applies a plan and returns the resulting ids in display order. */
function applyPlan(
  siblings: OrderedItem[],
  plan: { position: number; rebalance: OrderedItem[] },
  itemId: string,
): string[] {
  const positions = new Map(siblings.map((s) => [s.id, s.position]));
  for (const entry of plan.rebalance) positions.set(entry.id, entry.position);
  positions.set(itemId, plan.position);

  return [...positions.entries()].sort(([, a], [, b]) => a - b).map(([id]) => id);
}

const list = (...positions: number[]): OrderedItem[] =>
  positions.map((position, index) => ({ id: `s${index + 1}`, position }));

describe('initialPositions', () => {
  it('spaces a fresh list evenly', () => {
    expect(initialPositions(4)).toEqual([1000, 2000, 3000, 4000]);
  });

  it('returns nothing for an empty list', () => {
    expect(initialPositions(0)).toEqual([]);
  });
});

describe('appendPosition', () => {
  it('starts at the step for an empty list', () => {
    expect(appendPosition([])).toBe(POSITION_STEP);
  });

  it('adds a step beyond the highest position', () => {
    expect(appendPosition(list(1000, 2000, 3000))).toBe(4000);
  });

  it('ignores the input order', () => {
    expect(appendPosition(list(3000, 1000, 2000))).toBe(4000);
  });
});

describe('planPlacement — inserting', () => {
  it('appends when no anchor is given', () => {
    expect(planPlacement(list(1000, 2000), undefined).position).toBe(3000);
  });

  it('prepends below the first item when the anchor is null', () => {
    expect(planPlacement(list(1000, 2000), null).position).toBe(0);
  });

  it('takes the midpoint between two neighbours', () => {
    expect(planPlacement(list(1000, 2000), 's1').position).toBe(1500);
  });

  it('appends when anchored to the last item', () => {
    expect(planPlacement(list(1000, 2000), 's2').position).toBe(3000);
  });

  it('does not renumber neighbours in the common case', () => {
    expect(planPlacement(list(1000, 2000), 's1').rebalance).toEqual([]);
  });

  it('rejects an unknown anchor', () => {
    expect(() => planPlacement(list(1000), 'missing')).toThrow(/unknown sibling/i);
  });
});

describe('planPlacement — moving an existing item', () => {
  it('excludes the moving item from its own neighbour calculation', () => {
    // Moving s1 after s2 must land between s2 and s3, not between s1 and s2.
    expect(planPlacement(list(1000, 2000, 3000), 's2', 's1').position).toBe(2500);
  });

  it('moves an item to the front', () => {
    expect(planPlacement(list(1000, 2000, 3000), null, 's3').position).toBe(0);
  });

  it('moves an item to the end', () => {
    expect(planPlacement(list(1000, 2000, 3000), 's3', 's1').position).toBe(4000);
  });

  it('treats a move onto itself as a no-op', () => {
    const plan = planPlacement(list(1000, 2000, 3000), 's2', 's2');
    expect(plan.position).toBe(2000);
    expect(plan.rebalance).toEqual([]);
  });

  it('produces the expected final ordering', () => {
    const siblings = list(1000, 2000, 3000);
    const plan = planPlacement(siblings, 's3', 's1');
    expect(applyPlan(siblings, plan, 's1')).toEqual(['s2', 's3', 's1']);
  });
});

describe('planPlacement — rebalancing', () => {
  it('renumbers when the gap is exhausted', () => {
    const siblings = list(1000, 1000 + POSITION_MIN_GAP / 2, 2000);
    const plan = planPlacement(siblings, 's1');

    expect(plan.rebalance.length).toBeGreaterThan(0);
    expect(applyPlan(siblings, plan, 'new')).toEqual(['s1', 'new', 's2', 's3']);
  });

  it('keeps positions distinct after a rebalance', () => {
    const siblings = list(1000, 1000 + POSITION_MIN_GAP / 2, 2000);
    const plan = planPlacement(siblings, 's1');

    const positions = new Map(siblings.map((s) => [s.id, s.position]));
    for (const entry of plan.rebalance) positions.set(entry.id, entry.position);
    positions.set('new', plan.position);

    const values = [...positions.values()];
    expect(new Set(values).size).toBe(values.length);
  });

  it('rebalances correctly when prepending into an exhausted gap', () => {
    const siblings = list(POSITION_MIN_GAP / 4, POSITION_MIN_GAP / 2);
    const plan = planPlacement(siblings, null);
    expect(applyPlan(siblings, plan, 'new')).toEqual(['new', 's1', 's2']);
  });

  /**
   * The regression this whole mechanism exists for: dropping repeatedly into
   * the same slot halves the gap each time. Without rebalancing, the positions
   * collapse to equality and the order silently scrambles.
   */
  it('survives many insertions into the same slot', () => {
    let siblings: OrderedItem[] = list(1000, 2000);
    let order = ['s1', 's2'];

    for (let i = 0; i < 200; i += 1) {
      const id = `n${i}`;
      const plan = planPlacement(siblings, 's1');
      order = applyPlan(siblings, plan, id);

      const positions = new Map(siblings.map((s) => [s.id, s.position]));
      for (const entry of plan.rebalance) positions.set(entry.id, entry.position);
      positions.set(id, plan.position);
      siblings = [...positions.entries()].map(([itemId, position]) => ({ id: itemId, position }));
    }

    expect(siblings).toHaveLength(202);
    expect(new Set(siblings.map((s) => s.position)).size).toBe(202);
    expect(order[0]).toBe('s1');
    // Every insertion went directly after s1, so the newest is always second.
    expect(order[1]).toBe('n199');
    expect(order[order.length - 1]).toBe('s2');
  });
});
