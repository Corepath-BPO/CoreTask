import type { Goal } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { descendantsOf, flattenGoalTree } from './goal-tree';

const goal = (id: string, parentId: string | null = null): Goal => ({
  id,
  workspaceId: 'w',
  parentId,
  name: id,
  description: null,
  status: 'NO_STATUS',
  progressSource: 'MANUAL',
  progress: 0,
  metric: null,
  owner: null,
  team: null,
  timePeriod: null,
  dueDate: null,
  projects: [],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

const goals = [goal('company'), goal('sales', 'company'), goal('deal', 'sales'), goal('ops')];

describe('flattenGoalTree', () => {
  it('walks depth-first with depths and child counts', () => {
    const rows = flattenGoalTree(goals, new Set());
    expect(rows.map((row) => [row.goal.id, row.depth, row.childCount])).toEqual([
      ['company', 0, 1],
      ['sales', 1, 1],
      ['deal', 2, 0],
      ['ops', 0, 0],
    ]);
  });

  it('leaves out the inside of a collapsed branch', () => {
    const rows = flattenGoalTree(goals, new Set(['sales']));
    expect(rows.map((row) => row.goal.id)).toEqual(['company', 'sales', 'ops']);
  });

  it('starts a branch for a goal whose parent is missing', () => {
    const rows = flattenGoalTree([goal('orphan', 'gone')], new Set());
    expect(rows.map((row) => [row.goal.id, row.depth])).toEqual([['orphan', 0]]);
  });
});

describe('descendantsOf', () => {
  it('collects every level beneath a goal, and not the goal itself', () => {
    expect([...descendantsOf(goals, 'company')].sort()).toEqual(['deal', 'sales']);
    expect(descendantsOf(goals, 'ops').size).toBe(0);
  });
});
