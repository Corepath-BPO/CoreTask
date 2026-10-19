import { GoalProgressSource } from '@coretask/contracts';

import { rollUpProgress, wouldCreateCycle, type ProgressNode } from './goal-progress';

const node = (overrides: Partial<ProgressNode> & { id: string }): ProgressNode => ({
  parentId: null,
  progressSource: GoalProgressSource.MANUAL,
  progress: 0,
  projectIds: [],
  ...overrides,
});

describe('rollUpProgress', () => {
  it('reads a manual goal’s stored value, clamped to 0–100', () => {
    const result = rollUpProgress(
      [node({ id: 'a', progress: 40 }), node({ id: 'b', progress: 140 })],
      new Map(),
    );
    expect(result.get('a')).toBe(40);
    expect(result.get('b')).toBe(100);
  });

  it('averages connected projects, ignoring projects it cannot see', () => {
    const result = rollUpProgress(
      [
        node({
          id: 'g',
          progressSource: GoalProgressSource.PROJECTS,
          projectIds: ['p1', 'p2', 'hidden'],
        }),
      ],
      new Map([
        ['p1', 50],
        ['p2', 100],
      ]),
    );
    expect(result.get('g')).toBe(75);
  });

  it('rolls sub-goals up through several levels, each by its own rule', () => {
    const result = rollUpProgress(
      [
        node({ id: 'company', progressSource: GoalProgressSource.SUB_GOALS }),
        node({ id: 'team', parentId: 'company', progressSource: GoalProgressSource.SUB_GOALS }),
        node({ id: 'manual', parentId: 'company', progress: 20 }),
        node({
          id: 'projects',
          parentId: 'team',
          progressSource: GoalProgressSource.PROJECTS,
          projectIds: ['p'],
        }),
      ],
      new Map([['p', 80]]),
    );
    expect(result.get('team')).toBe(80);
    expect(result.get('company')).toBe(50);
  });

  it('reads 0 when there is nothing to average', () => {
    const result = rollUpProgress(
      [
        node({ id: 'empty', progressSource: GoalProgressSource.SUB_GOALS }),
        node({ id: 'none', progressSource: GoalProgressSource.PROJECTS }),
      ],
      new Map(),
    );
    expect(result.get('empty')).toBe(0);
    expect(result.get('none')).toBe(0);
  });

  it('survives a cycle in the data without recursing forever', () => {
    const result = rollUpProgress(
      [
        node({ id: 'a', parentId: 'b', progressSource: GoalProgressSource.SUB_GOALS }),
        node({ id: 'b', parentId: 'a', progressSource: GoalProgressSource.SUB_GOALS }),
      ],
      new Map(),
    );
    expect(result.get('a')).toBe(0);
  });
});

describe('wouldCreateCycle', () => {
  const parentOf = new Map<string, string | null>([
    ['root', null],
    ['child', 'root'],
    ['grandchild', 'child'],
  ]);

  it('refuses a goal under itself or under its own descendant', () => {
    expect(wouldCreateCycle('root', 'root', parentOf)).toBe(true);
    expect(wouldCreateCycle('root', 'grandchild', parentOf)).toBe(true);
  });

  it('allows moving a goal under an unrelated branch', () => {
    expect(wouldCreateCycle('grandchild', 'root', parentOf)).toBe(false);
  });
});
