import type { Task } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { acceptsDrop, cellLoad, mondayOf, weeklyWorkload, workloadMove } from './weekly-workload';

const ada = { id: 'u-1', name: 'Ada', email: 'a@x.org', avatarUrl: null };
const bea = { id: 'u-2', name: 'Bea', email: 'b@x.org', avatarUrl: null };

const task = (over: Partial<Task>): Task =>
  ({
    id: Math.random().toString(36).slice(2),
    title: 'Task',
    assigneeId: null,
    assignee: null,
    dueDate: null,
    completedAt: null,
    archivedAt: null,
    estimatedMinutes: null,
    ...over,
  }) as Task;

// Wednesday 14 October 2026.
const NOW = new Date(2026, 9, 14, 10);

describe('weeklyWorkload', () => {
  it('puts each open task in its person’s row and the week it is due', () => {
    const { columns, rows } = weeklyWorkload(
      [
        task({ assigneeId: 'u-1', assignee: ada, dueDate: '2026-10-12T00:00:00.000Z' }),
        task({ assigneeId: 'u-1', assignee: ada, dueDate: '2026-10-16T00:00:00.000Z' }),
        task({ assigneeId: 'u-1', assignee: ada, dueDate: '2026-10-19T00:00:00.000Z' }),
        task({ assigneeId: 'u-1', assignee: ada, dueDate: '2027-01-30T00:00:00.000Z' }),
        task({ assigneeId: 'u-2', assignee: bea, estimatedMinutes: 90 }),
        task({ dueDate: '2026-10-14T00:00:00.000Z' }),
        task({ assigneeId: 'u-2', assignee: bea, completedAt: '2026-10-01T00:00:00Z' }),
      ],
      NOW,
    );

    expect(columns.map((column) => column.key)).toEqual([
      'overdue',
      'w0',
      'w1',
      'w2',
      'w3',
      'w4',
      'w5',
      'later',
      'none',
    ]);
    expect(columns[1]?.label).toBe('This week');
    expect(columns[2]?.label).toBe('Week of Oct 19');

    expect(rows.map((row) => row.person?.name ?? 'Unassigned')).toEqual([
      'Ada',
      'Bea',
      'Unassigned',
    ]);
    const [adaRow, beaRow, nobody] = rows;
    expect(adaRow?.cells['overdue']).toHaveLength(1);
    expect(adaRow?.cells['w0']).toHaveLength(1);
    expect(adaRow?.cells['w1']).toHaveLength(1);
    expect(adaRow?.cells['later']).toHaveLength(1);
    expect(beaRow?.open).toBe(1);
    expect(beaRow?.cells['none']).toHaveLength(1);
    expect(nobody?.cells['w0']).toHaveLength(1);
    expect(cellLoad(beaRow?.cells['none'], 'hours')).toBe(1.5);
    expect(cellLoad(beaRow?.cells['none'], 'tasks')).toBe(1);
  });

  it('takes Monday as the start of a week', () => {
    const wednesday = Date.UTC(2026, 9, 14);
    expect(new Date(mondayOf(wednesday)).toISOString().slice(0, 10)).toBe('2026-10-12');
    const sunday = Date.UTC(2026, 9, 18);
    expect(new Date(mondayOf(sunday)).toISOString().slice(0, 10)).toBe('2026-10-12');
  });
});

describe('workloadMove', () => {
  const { columns } = weeklyWorkload([], NOW);
  const column = (key: string) => columns.find((entry) => entry.key === key)!;

  it('hands a task to the row it is dropped on', () => {
    const due = task({ assigneeId: 'u-1', dueDate: '2026-10-16T00:00:00.000Z' });
    expect(workloadMove(due, 'w0', { personId: 'u-2', column: column('w0') }, NOW)).toEqual({
      assigneeId: 'u-2',
    });
    expect(workloadMove(due, 'w0', { personId: null, column: column('w0') }, NOW)).toEqual({
      assigneeId: null,
    });
    expect(workloadMove(due, 'w0', { personId: 'u-1', column: column('w0') }, NOW)).toBeNull();
  });

  it('moves the due date to the same weekday, keeping the task’s length', () => {
    // Friday the 16th, with a start on Tuesday and a time, dropped two weeks on.
    const due = task({
      assigneeId: 'u-1',
      startDate: '2026-10-13T00:00:00.000Z',
      dueDate: '2026-10-16T00:00:00.000Z',
      dueAt: '2026-10-16T17:00:00.000Z',
    });
    expect(workloadMove(due, 'w0', { personId: 'u-1', column: column('w2') }, NOW)).toEqual({
      dueDate: '2026-10-30',
      dueAt: '2026-10-30T17:00:00.000Z',
      startDate: '2026-10-27',
    });
  });

  it('never lands on a day already past, and gives an undated task a Friday', () => {
    const monday = task({ dueDate: '2026-10-19T00:00:00.000Z' });
    // Monday the 12th is gone; today, Wednesday the 14th, is the soonest.
    expect(workloadMove(monday, 'w1', { personId: null, column: column('w0') }, NOW)).toEqual({
      dueDate: '2026-10-14',
    });
    const undated = task({});
    expect(workloadMove(undated, 'none', { personId: null, column: column('w1') }, NOW)).toEqual({
      dueDate: '2026-10-23',
    });
  });

  it('clears the date in "No due date", and takes the piles only as they are', () => {
    const due = task({ dueDate: '2026-10-16T00:00:00.000Z', dueAt: '2026-10-16T17:00:00.000Z' });
    expect(workloadMove(due, 'w0', { personId: null, column: column('none') }, NOW)).toEqual({
      dueDate: null,
      dueAt: null,
    });
    expect(acceptsDrop(column('later'), 'w0')).toBe(false);
    expect(acceptsDrop(column('overdue'), 'overdue')).toBe(true);
    expect(workloadMove(due, 'w0', { personId: 'u-1', column: column('later') }, NOW)).toBeNull();
  });
});
