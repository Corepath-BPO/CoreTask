import type { ProjectFieldMetadata, ViewColumn } from '@coretask/types';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from '@dnd-kit/sortable';
import { Pin, PinOff } from 'lucide-react';
import { useRef } from 'react';

import { cn } from '@/lib/utils';

import {
  clampWidth,
  columnWidth,
  isPinnedColumn,
  isFixedColumn,
  moveColumn,
  setPinned,
} from '../lib/column-layout';
import { columnLabel } from '../lib/column-labels';

/** Where a pinned column sits, and whether it is the one casting the shadow. */
export interface PinnedProps {
  offsets: Map<string, number>;
  lastPinned: string | null;
  scrolled: boolean;
}

/**
 * The header row: drag to reorder, drag the edge to resize, click to pin.
 *
 * All three change the same saved setting, so they live together rather than in
 * a menu somewhere else — the column you want to move is the one under your
 * cursor.
 */
export function ColumnHeaderTable({
  columns,
  metadata,
  canEdit,
  pinned,
  onChange,
  onResizePreview,
  addControl,
  widths,
}: {
  columns: ViewColumn[];
  metadata: ProjectFieldMetadata | undefined;
  canEdit: boolean;
  pinned: PinnedProps;
  onChange: (columns: ViewColumn[]) => void;
  /** Live width while a drag is in progress; null once it is committed. */
  onResizePreview: (preview: { field: string; width: number } | null) => void;
  addControl: React.ReactNode;
  /** The shared `<colgroup>`, so this table sizes like the ones below it. */
  widths: React.ReactNode;
}) {
  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so clicking the pin button
    // inside a draggable header is still a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const toIndex = columns.findIndex((column) => column.field === over.id);
    if (toIndex === -1) return;

    onChange(moveColumn(columns, String(active.id), toIndex));
  };

  const body = columns.map((column) => (
    <HeaderCell
      key={column.field}
      column={column}
      label={columnLabel(column.field, metadata)}
      canEdit={canEdit}
      pinned={pinned}
      onPin={(isPinned) => onChange(setPinned(columns, column.field, isPinned))}
      onResizePreview={onResizePreview}
      onResizeEnd={(width) =>
        onChange(
          columns.map((entry) => (entry.field === column.field ? { ...entry, width } : entry)),
        )
      }
    />
  ));

  /*
   * `DndContext` wraps the table, never the row.
   *
   * It renders a live region for screen readers, and inside a `<tr>` that
   * became two phantom cells among the headers — enough to throw the header's
   * column widths out of step with every card below it. The measurements
   * looked fine until a column was resized and the surplus width had somewhere
   * different to go in each table.
   */
  const table = (
    <table className="w-full table-fixed text-sm">
      {widths}
      <thead>
        <tr className="text-left">
          {canEdit ? (
            <SortableContext
              items={columns.map((column) => column.field)}
              strategy={horizontalListSortingStrategy}
            >
              {body}
            </SortableContext>
          ) : (
            body
          )}

          <th scope="col" className="pb-1">
            {addControl}
          </th>

          {/* Matches the spacer every other table declares. */}
          <th aria-hidden="true" />
        </tr>
      </thead>
    </table>
  );

  if (!canEdit) return table;

  return (
    /*
     * `pointerWithin`: the column you drop on is the one under the cursor.
     *
     * Centre-distance works too — dnd-kit tracks the drag delta itself, so it
     * does not need the CSS transform this header deliberately omits. But these
     * columns differ in width by a factor of five, and centre-distance measures
     * from the middle of the *dragged* column, so a wide one nudged slightly
     * can resolve to a neighbour the pointer never touched.
     */
    <DndContext sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}>
      {table}
    </DndContext>
  );
}

function HeaderCell({
  column,
  label,
  canEdit,
  pinned,
  onPin,
  onResizePreview,
  onResizeEnd,
}: {
  column: ViewColumn;
  label: string;
  canEdit: boolean;
  pinned: PinnedProps;
  onPin: (isPinned: boolean) => void;
  onResizePreview: (preview: { field: string; width: number } | null) => void;
  onResizeEnd: (width: number) => void;
}) {
  /*
   * The Task column is not a sortable at all, rather than a sortable that
   * refuses to move: disabled, it is neither dragged nor dropped onto, so there
   * is no drop indicator promising a rearrangement that will not happen.
   */
  const isFixed = isFixedColumn(column.field);

  const { attributes, listeners, setNodeRef, isDragging, isOver } = useSortable({
    id: column.field,
    disabled: !canEdit || isFixed,
  });

  const canArrange = canEdit && !isFixed;

  /*
   * No `transform` from the sortable, deliberately.
   *
   * A transform makes the element a containing block, which silently kills
   * `position: sticky` on the pinned columns — the frozen block would scroll
   * away the moment anyone dragged. Dimming the dragged column and marking the
   * drop target says the same thing without touching layout.
   */
  const left = pinned.offsets.get(column.field);
  const isPinned = left !== undefined;

  return (
    <th
      ref={setNodeRef}
      scope="col"
      style={isPinned ? { left } : undefined}
      className={cn(
        'group/header border-r border-border/60 px-3 pb-1 text-xs font-medium text-muted-foreground',
        isPinned && 'sticky z-20 bg-background',
        // The shadow belongs to the last frozen column: it marks where the
        // frozen block ends and the scrolling part begins.
        column.field === pinned.lastPinned &&
          pinned.scrolled &&
          'after:absolute after:inset-y-0 after:-right-3 after:w-3 after:bg-gradient-to-r after:from-black/10 after:to-transparent',
        isDragging && 'opacity-40',
        isOver && !isDragging && 'bg-muted',
      )}
    >
      <span className="relative flex items-center gap-1">
        <span
          {...(canArrange ? { ...attributes, ...listeners } : {})}
          className={cn('flex-1 truncate', canArrange && 'cursor-grab active:cursor-grabbing')}
        >
          {label}
        </span>

        {canArrange && (
          <button
            type="button"
            onClick={() => onPin(!isPinnedColumn(column))}
            aria-label={`${isPinnedColumn(column) ? 'Unpin' : 'Pin'} ${label}`}
            aria-pressed={isPinnedColumn(column)}
            className={cn(
              'shrink-0 cursor-pointer rounded p-0.5 hover:bg-muted focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
              // A pinned column keeps its icon: it is state, not a hover action.
              isPinnedColumn(column)
                ? 'text-foreground'
                : 'opacity-0 transition-opacity group-hover/header:opacity-100',
            )}
          >
            {isPinnedColumn(column) ? (
              <Pin className="size-3" aria-hidden="true" />
            ) : (
              <PinOff className="size-3" aria-hidden="true" />
            )}
          </button>
        )}

        {canEdit && (
          <ResizeHandle
            label={label}
            startWidth={columnWidth(column)}
            onPreview={(width) => onResizePreview({ field: column.field, width })}
            onEnd={(width) => {
              onResizePreview(null);
              onResizeEnd(width);
            }}
          />
        )}
      </span>
    </th>
  );
}

/**
 * The draggable right edge of a column.
 *
 * Pointer capture rather than window listeners: the pointer stays with this
 * element even when it leaves it, so a fast drag does not lose the column
 * halfway through. `stopPropagation` keeps the drag from also being read as a
 * reorder by the sortable wrapping it.
 */
function ResizeHandle({
  label,
  startWidth,
  onPreview,
  onEnd,
}: {
  label: string;
  startWidth: number;
  onPreview: (width: number) => void;
  onEnd: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  const widthAt = (clientX: number) => {
    const from = drag.current;
    if (!from) return startWidth;
    return clampWidth(from.width + (clientX - from.x));
  };

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label}`}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        drag.current = { x: event.clientX, width: startWidth };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        onPreview(widthAt(event.clientX));
      }}
      onPointerUp={(event) => {
        if (!drag.current) return;
        const width = widthAt(event.clientX);
        drag.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        onEnd(width);
      }}
      onPointerCancel={() => {
        drag.current = null;
        onEnd(startWidth);
      }}
      // Sits over the cell's padding so the whole gutter between two labels is
      // grabbable, not a one-pixel line nobody can hit.
      className="absolute -right-3 top-1/2 h-5 w-2 -translate-y-1/2 cursor-col-resize rounded-full hover:bg-primary/40"
    />
  );
}
