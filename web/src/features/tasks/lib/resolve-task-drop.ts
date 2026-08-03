import { arrayMove } from '@dnd-kit/sortable';
import type { Task } from '@coretask/types';

/** Board tasks grouped by section id, each list already in display order. */
export type TaskGroups = Record<string, Task[]>;

export interface TaskDropTarget {
  /** The id dnd-kit reported as `over` — a task id, or a column's droppable id. */
  id: string;
  type: 'task' | 'column';
  /** Set when `type` is `column`. */
  sectionId?: string;
}

export interface TaskDropPlan {
  sectionId: string;
  /** Sibling the task now sits after; `null` when it landed at the top. */
  afterTaskId: string | null;
  /** Regrouped lists, for the optimistic update. */
  groups: TaskGroups;
}

/**
 * Translates a dnd-kit drop into the API's move contract.
 *
 * Two behaviours have to differ, which is the whole reason this is a tested
 * function rather than inline logic:
 *
 *   * Within one column, a drop *takes the target's index* — dragging A onto C
 *     in `[A,B,C]` yields `[B,C,A]`, matching how sortable lists behave.
 *   * Across columns, the task is *inserted before* the item it was dropped on,
 *     because the target has not moved out of the way.
 *
 * Returns `null` for a no-op or an unresolvable drop.
 */
export function resolveTaskDrop(
  groups: TaskGroups,
  activeId: string,
  target: TaskDropTarget,
): TaskDropPlan | null {
  const sourceSectionId = findSectionOf(groups, activeId);
  if (sourceSectionId === null) return null;

  const destinationSectionId =
    target.type === 'column' ? (target.sectionId ?? null) : findSectionOf(groups, target.id);

  if (destinationSectionId === null || !(destinationSectionId in groups)) return null;
  if (target.type === 'task' && target.id === activeId) return null;

  const next: TaskGroups = Object.fromEntries(
    Object.entries(groups).map(([key, list]) => [key, [...list]]),
  );

  const source = next[sourceSectionId] as Task[];
  const destination = next[destinationSectionId] as Task[];

  if (sourceSectionId === destinationSectionId) {
    const from = source.findIndex((task) => task.id === activeId);
    const to =
      target.type === 'column'
        ? source.length - 1
        : source.findIndex((task) => task.id === target.id);

    if (from === -1 || to === -1 || from === to) return null;
    next[sourceSectionId] = arrayMove(source, from, to);
  } else {
    const from = source.findIndex((task) => task.id === activeId);
    if (from === -1) return null;

    const [moved] = source.splice(from, 1);
    if (!moved) return null;

    const insertAt =
      target.type === 'column'
        ? destination.length
        : Math.max(
            0,
            destination.findIndex((task) => task.id === target.id),
          );

    destination.splice(insertAt, 0, moved);
  }

  const finalList = next[destinationSectionId] as Task[];
  const finalIndex = finalList.findIndex((task) => task.id === activeId);

  return {
    sectionId: destinationSectionId,
    afterTaskId: finalIndex <= 0 ? null : (finalList[finalIndex - 1]?.id ?? null),
    groups: next,
  };
}

function findSectionOf(groups: TaskGroups, taskId: string): string | null {
  for (const [sectionId, list] of Object.entries(groups)) {
    if (list.some((task) => task.id === taskId)) return sectionId;
  }
  return null;
}
