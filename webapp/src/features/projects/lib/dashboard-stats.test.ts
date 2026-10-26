import { describe, expect, it } from 'vitest';

import { computeDashboard, type CountableItem } from './dashboard-stats';

const amy = { id: 'amy', name: 'Amy' };
const ben = { id: 'ben', name: 'Ben' };

const item = (overrides: Partial<CountableItem>): CountableItem => ({
  sectionId: 's1',
  parentId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  completedAt: null,
  dueDate: null,
  assignees: [],
  ...overrides,
});

const sections = [
  { id: 's1', name: 'To do' },
  { id: 's2', name: 'Doing' },
];

describe('computeDashboard', () => {
  it('counts top-level work only, and splits it by completion', () => {
    const stats = computeDashboard(
      [item({}), item({ completedAt: '2026-10-01T10:00:00.000Z' }), item({ parentId: 'x' })],
      sections,
      '2026-10-10',
    );
    expect(stats).toMatchObject({ total: 2, completed: 1, incomplete: 1 });
  });

  it('calls an unfinished task overdue only once its due day has passed', () => {
    const stats = computeDashboard(
      [
        item({ dueDate: '2026-10-09T00:00:00.000Z' }),
        item({ dueDate: '2026-10-10T00:00:00.000Z' }),
        item({ dueDate: '2026-10-01T00:00:00.000Z', completedAt: '2026-10-02T09:00:00.000Z' }),
      ],
      sections,
      '2026-10-10',
    );
    expect(stats.overdue).toBe(1);
  });

  it('lists every section in order, empty ones as zero, orphans last', () => {
    const stats = computeDashboard(
      [item({ sectionId: 's2' }), item({ sectionId: null })],
      sections,
      '2026-10-10',
    );
    expect(stats.bySection).toEqual([
      { id: 's1', label: 'To do', value: 0 },
      { id: 's2', label: 'Doing', value: 1 },
      { id: '', label: 'No section', value: 1 },
    ]);
  });

  it('ranks people by open work and keeps the unassigned last', () => {
    const stats = computeDashboard(
      [
        item({ assignees: [amy] }),
        item({ assignees: [ben] }),
        item({ assignees: [ben] }),
        item({}),
        item({}),
        item({}),
      ],
      sections,
      '2026-10-10',
    );
    expect(stats.byAssignee.map((entry) => [entry.label, entry.value])).toEqual([
      ['Ben', 2],
      ['Amy', 1],
      ['Unassigned', 3],
    ]);
  });

  it('builds a cumulative burn-up ending with this week', () => {
    const stats = computeDashboard(
      [
        item({ createdAt: '2026-09-28T10:00:00.000Z' }),
        item({ createdAt: '2026-10-06T10:00:00.000Z', completedAt: '2026-10-08T10:00:00.000Z' }),
      ],
      sections,
      '2026-10-10',
      3,
    );
    expect(stats.burnup.map((point) => point.week)).toEqual([
      '2026-09-21',
      '2026-09-28',
      '2026-10-05',
    ]);
    expect(stats.burnup.map((point) => [point.total, point.completed])).toEqual([
      [0, 0],
      [1, 0],
      [2, 1],
    ]);
  });
});
