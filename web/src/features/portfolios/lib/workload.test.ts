import type { Task } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { capacityOf, loadOf, workloadByPerson, type WorkloadRow } from './workload';

const ada = { id: 'u-1', name: 'Ada', email: 'ada@acme.test', avatarUrl: null };
const bea = { id: 'u-2', name: 'Bea', email: 'bea@acme.test', avatarUrl: null };

const task = (over: Partial<Task>): Task =>
  ({
    id: Math.random().toString(36),
    assigneeId: null,
    assignee: null,
    dueDate: null,
    completedAt: null,
    archivedAt: null,
    estimatedMinutes: null,
    ...over,
  }) as Task;

describe('workloadByPerson', () => {
  // Saturday 10 October 2026, local noon.
  const now = new Date(2026, 9, 10, 12);

  it('counts open work per person, with overdue and this week apart', () => {
    const rows = workloadByPerson(
      [
        task({ assigneeId: 'u-1', assignee: ada, dueDate: '2026-10-09T00:00:00.000Z' }),
        task({
          assigneeId: 'u-1',
          assignee: ada,
          dueDate: '2026-10-10T00:00:00.000Z',
          estimatedMinutes: 30,
        }),
        task({ assigneeId: 'u-1', assignee: ada, dueDate: '2026-10-17T00:00:00.000Z' }),
        task({ assigneeId: 'u-2', assignee: bea, estimatedMinutes: 60 }),
        task({ assigneeId: 'u-2', assignee: bea, completedAt: '2026-10-01T00:00:00.000Z' }),
        task({}),
      ],
      now,
    );

    expect(rows).toEqual([
      {
        person: { id: 'u-1', name: 'Ada', avatarUrl: null },
        open: 3,
        overdue: 1,
        dueThisWeek: 1,
        estimatedMinutes: 30,
      },
      {
        person: { id: 'u-2', name: 'Bea', avatarUrl: null },
        open: 1,
        overdue: 0,
        dueThisWeek: 0,
        estimatedMinutes: 60,
      },
      { person: null, open: 1, overdue: 0, dueThisWeek: 0, estimatedMinutes: 0 },
    ]);
  });

  it('leaves out completed and archived work entirely', () => {
    expect(
      workloadByPerson(
        [
          task({ assigneeId: 'u-1', assignee: ada, completedAt: '2026-10-01T00:00:00.000Z' }),
          task({ assigneeId: 'u-1', assignee: ada, archivedAt: '2026-10-01T00:00:00.000Z' }),
        ],
        now,
      ),
    ).toEqual([]);
  });
});

describe('loadOf and capacityOf', () => {
  const row: WorkloadRow = {
    person: { id: 'u-1', name: 'Ada', avatarUrl: null },
    open: 4,
    overdue: 0,
    dueThisWeek: 1,
    estimatedMinutes: 200,
  };
  const workload = {
    measure: 'TASKS' as const,
    defaultCapacity: 5,
    capacities: [{ userId: 'u-2', capacity: 2 }],
  };

  it('measures load as open tasks, or as estimated hours', () => {
    expect(loadOf(row, 'TASKS')).toBe(4);
    expect(loadOf(row, 'HOURS')).toBe(3.3);
  });

  it('takes a person’s own capacity, else the default, and none for nobody', () => {
    expect(capacityOf('u-2', workload)).toBe(2);
    expect(capacityOf('u-1', workload)).toBe(5);
    expect(capacityOf(null, workload)).toBeNull();
    expect(capacityOf('u-1', { ...workload, defaultCapacity: null })).toBeNull();
  });
});
