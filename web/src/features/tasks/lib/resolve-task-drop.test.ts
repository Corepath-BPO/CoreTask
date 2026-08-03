import type { Task } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { resolveTaskDrop, type TaskGroups } from './resolve-task-drop';

const task = (id: string, sectionId: string): Task => ({
  id,
  workspaceId: 'w',
  projectId: 'p',
  sectionId,
  parentTaskId: null,
  title: id,
  description: null,
  status: 'TODO',
  priority: 'NONE',
  position: 0,
  startDate: null,
  dueDate: null,
  completedAt: null,
  archivedAt: null,
  estimatedMinutes: null,
  assigneeId: null,
  assignee: null,
  createdById: 'u',
  subtaskCount: 0,
  completedSubtaskCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

function groups(): TaskGroups {
  return {
    todo: [task('a', 'todo'), task('b', 'todo'), task('c', 'todo')],
    doing: [task('x', 'doing'), task('y', 'doing')],
    done: [],
  };
}

const ids = (plan: ReturnType<typeof resolveTaskDrop>, section: string) =>
  plan?.groups[section]?.map((entry) => entry.id);

describe('resolveTaskDrop — within one column', () => {
  it('takes the target index when dragging down, like a sortable list', () => {
    const plan = resolveTaskDrop(groups(), 'a', { id: 'c', type: 'task' });

    expect(ids(plan, 'todo')).toEqual(['b', 'c', 'a']);
    expect(plan?.afterTaskId).toBe('c');
    expect(plan?.sectionId).toBe('todo');
  });

  it('takes the target index when dragging up', () => {
    const plan = resolveTaskDrop(groups(), 'c', { id: 'a', type: 'task' });

    expect(ids(plan, 'todo')).toEqual(['c', 'a', 'b']);
    expect(plan?.afterTaskId).toBeNull();
  });

  it('moves to the end when dropped on its own column body', () => {
    const plan = resolveTaskDrop(groups(), 'a', {
      id: 'col-todo',
      type: 'column',
      sectionId: 'todo',
    });

    expect(ids(plan, 'todo')).toEqual(['b', 'c', 'a']);
    expect(plan?.afterTaskId).toBe('c');
  });

  it('is a no-op when dropped on itself', () => {
    expect(resolveTaskDrop(groups(), 'a', { id: 'a', type: 'task' })).toBeNull();
  });

  it('is a no-op when the last item is dropped on its own column body', () => {
    expect(
      resolveTaskDrop(groups(), 'c', { id: 'col-todo', type: 'column', sectionId: 'todo' }),
    ).toBeNull();
  });
});

describe('resolveTaskDrop — across columns', () => {
  /**
   * The asymmetry that makes this worth testing: across columns the target has
   * not moved out of the way, so the task is inserted *before* it.
   */
  it('inserts before the task it was dropped on', () => {
    const plan = resolveTaskDrop(groups(), 'a', { id: 'y', type: 'task' });

    expect(ids(plan, 'doing')).toEqual(['x', 'a', 'y']);
    expect(ids(plan, 'todo')).toEqual(['b', 'c']);
    expect(plan?.afterTaskId).toBe('x');
    expect(plan?.sectionId).toBe('doing');
  });

  it('lands at the top when dropped on the first task of another column', () => {
    const plan = resolveTaskDrop(groups(), 'a', { id: 'x', type: 'task' });

    expect(ids(plan, 'doing')).toEqual(['a', 'x', 'y']);
    expect(plan?.afterTaskId).toBeNull();
  });

  it('appends when dropped on another column body', () => {
    const plan = resolveTaskDrop(groups(), 'a', {
      id: 'col-doing',
      type: 'column',
      sectionId: 'doing',
    });

    expect(ids(plan, 'doing')).toEqual(['x', 'y', 'a']);
    expect(plan?.afterTaskId).toBe('y');
  });

  it('moves into an empty column', () => {
    const plan = resolveTaskDrop(groups(), 'a', {
      id: 'col-done',
      type: 'column',
      sectionId: 'done',
    });

    expect(ids(plan, 'done')).toEqual(['a']);
    expect(plan?.afterTaskId).toBeNull();
    expect(ids(plan, 'todo')).toEqual(['b', 'c']);
  });

  it('removes the task from its source column', () => {
    const plan = resolveTaskDrop(groups(), 'b', { id: 'x', type: 'task' });
    expect(ids(plan, 'todo')).toEqual(['a', 'c']);
  });
});

describe('resolveTaskDrop — guards and invariants', () => {
  it('returns null for an unknown active id', () => {
    expect(resolveTaskDrop(groups(), 'ghost', { id: 'a', type: 'task' })).toBeNull();
  });

  it('returns null for an unknown column', () => {
    expect(
      resolveTaskDrop(groups(), 'a', { id: 'col-nope', type: 'column', sectionId: 'nope' }),
    ).toBeNull();
  });

  it('does not mutate the input', () => {
    const original = groups();
    const snapshot = JSON.stringify(original);
    resolveTaskDrop(original, 'a', { id: 'y', type: 'task' });
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('never loses or duplicates a task', () => {
    const start = groups();
    const total = Object.values(start).flat().length;

    for (const activeId of ['a', 'b', 'c', 'x', 'y']) {
      for (const target of [
        { id: 'a', type: 'task' as const },
        { id: 'y', type: 'task' as const },
        { id: 'col-done', type: 'column' as const, sectionId: 'done' },
      ]) {
        const plan = resolveTaskDrop(start, activeId, target);
        if (!plan) continue;

        const all = Object.values(plan.groups)
          .flat()
          .map((entry) => entry.id);
        expect(all).toHaveLength(total);
        expect(new Set(all).size).toBe(total);
      }
    }
  });

  it('keeps afterTaskId consistent with the regrouped list', () => {
    for (const activeId of ['a', 'b', 'c', 'x', 'y']) {
      for (const overId of ['a', 'b', 'c', 'x', 'y']) {
        const plan = resolveTaskDrop(groups(), activeId, { id: overId, type: 'task' });
        if (!plan) continue;

        const list = plan.groups[plan.sectionId] ?? [];
        const index = list.findIndex((entry) => entry.id === activeId);
        const expected = index === 0 ? null : (list[index - 1]?.id ?? null);
        expect(plan.afterTaskId).toBe(expected);
      }
    }
  });
});
