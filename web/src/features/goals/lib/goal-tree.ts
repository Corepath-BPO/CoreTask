import type { Goal } from '@coretask/types';

export interface GoalRow {
  goal: Goal;
  depth: number;
  childCount: number;
}

/**
 * The goal tree flattened into rows, depth-first in the server's order, with
 * collapsed branches left out — what the Goals table draws.
 *
 * A goal whose parent is not in the list (archived, or filtered away) starts a
 * branch of its own instead of vanishing.
 */
export function flattenGoalTree(goals: readonly Goal[], collapsed: ReadonlySet<string>): GoalRow[] {
  const ids = new Set(goals.map((goal) => goal.id));
  const children = new Map<string | null, Goal[]>();
  for (const goal of goals) {
    const parent = goal.parentId && ids.has(goal.parentId) ? goal.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), goal]);
  }

  const rows: GoalRow[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const goal of children.get(parent) ?? []) {
      if (seen.has(goal.id)) continue;
      seen.add(goal.id);
      const childCount = children.get(goal.id)?.length ?? 0;
      rows.push({ goal, depth, childCount });
      if (!collapsed.has(goal.id)) walk(goal.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Every goal under `goalId`, at any depth — what a parent picker must not offer. */
export function descendantsOf(goals: readonly Goal[], goalId: string): Set<string> {
  const result = new Set<string>();
  const frontier = [goalId];
  while (frontier.length) {
    const current = frontier.pop() as string;
    for (const goal of goals) {
      if (goal.parentId === current && !result.has(goal.id)) {
        result.add(goal.id);
        frontier.push(goal.id);
      }
    }
  }
  return result;
}
