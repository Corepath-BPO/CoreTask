import { useDroppable } from '@dnd-kit/core';

/** Marks a row as a drop target, so a task can land between two others. */
export function useRowDropTarget(taskId: string) {
  const { setNodeRef, isOver } = useDroppable({ id: taskId, data: { type: 'task' } });
  return { ref: setNodeRef, isOver };
}
