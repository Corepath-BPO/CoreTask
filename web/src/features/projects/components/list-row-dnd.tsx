import {
  DndContext,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { GripVertical } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * Dragging a row into another section, the way a card moves on the board.
 *
 * The two views show the same tasks arranged the same way, so moving one should
 * work the same in both — having to switch to the board to change a task's
 * section is the kind of gap that makes a List view feel like a report rather
 * than a place to work.
 *
 * `pointerWithin`, as in the column header: the rows are wildly different
 * heights once subtasks are expanded, and centre-distance would resolve to a
 * neighbour the pointer never touched.
 */
export function ListDndContext({
  onDrop,
  children,
}: {
  onDrop: (taskId: string, target: { id: string; type: 'task' | 'column'; sectionId?: string }) => void;
  children: React.ReactNode;
}) {
  const sensors = useSensors(
    // Enough travel to be a drag: a row is covered in buttons, and a grab that
    // starts on the first pixel would swallow every click on a cell.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const data = over.data.current;

    onDrop(
      String(active.id),
      data?.['type'] === 'section'
        ? { id: String(over.id), type: 'column', sectionId: String(data['sectionId']) }
        : { id: String(over.id), type: 'task' },
    );
  };

  return (
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={handleDragEnd}>
      {children}
    </DndContext>
  );
}

/**
 * A section card that a row can be dropped onto.
 *
 * The whole card is the target, not just its empty space, so dropping into a
 * section that already has rows does not require finding a gap between them.
 */
export function SectionDropZone({
  sectionId,
  children,
}: {
  sectionId: string;
  children: (props: { ref: (node: HTMLElement | null) => void; isOver: boolean }) => React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `section:${sectionId}`,
    data: { type: 'section', sectionId },
  });

  return <>{children({ ref: setNodeRef, isOver })}</>;
}

/**
 * The grip that starts a row drag.
 *
 * A dedicated handle rather than the whole row: every cell in the row is
 * editable, and a row that drags from anywhere would make selecting text in a
 * cell impossible. Revealed on hover so a resting table stays quiet, but never
 * removed from the keyboard's reach — dnd-kit's own listeners handle space and
 * the arrow keys.
 */
export function RowDragHandle({ taskId, title }: { taskId: string; title: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: taskId,
    data: { type: 'task' },
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={`Move "${title}" to another section`}
      className={cn(
        'shrink-0 cursor-grab rounded text-muted-foreground opacity-0 transition-opacity active:cursor-grabbing',
        'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        'group-hover:opacity-100',
        isDragging && 'opacity-100',
      )}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="size-3.5" aria-hidden="true" />
    </button>
  );
}
