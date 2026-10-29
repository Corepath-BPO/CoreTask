import { SYSTEM_FIELD_CATALOG, type SortDirection } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewColumn } from '@coretask/types';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  pointerWithin,
  type DragEndEvent,
} from '@dnd-kit/core';
import { horizontalListSortingStrategy, SortableContext, useSortable } from '@dnd-kit/sortable';
import { Pin } from 'lucide-react';
import { useRef } from 'react';

import { cn } from '@/lib/utils';

import {
  clampWidth,
  columnWidth,
  insertColumnAfter,
  isPinnedColumn,
  isFixedColumn,
  moveColumn,
  setPinned,
  toggleColumn,
} from '../lib/column-layout';
import { columnLabel, columnMinWidth } from '../lib/column-labels';
import { findQueryableField } from '../lib/view-fields';

import { ColumnMenu, type ColumnMenuActions } from './column-menu';

/** Where a pinned column sits, and whether it is the one casting the shadow. */
export interface PinnedProps {
  offsets: Map<string, number>;
  lastPinned: string | null;
  scrolled: boolean;
}

/**
 * The header row: drag to reorder, drag the edge to resize, and each column's
 * menu (Asana's chevron) for the rest — edit its field, sort, filter or group
 * by it, add a column beside it, move, pin or hide it.
 *
 * They change the view the header belongs to, so they live on it rather than
 * in a menu somewhere else: the column you mean is the one under your cursor.
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
  titleMinWidth,
  onEditField,
  onSort,
  onFilter,
  onGroup,
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
  /** The Name column's floor — the view measures its widest section header. */
  titleMinWidth?: number | undefined;
  /** Opens the edit dialog for a custom field's column. */
  onEditField?: ((fieldId: string) => void) | undefined;
  /** The view's own settings, read by a column: absent where the view cannot change. */
  onSort?: ((field: string, direction: SortDirection) => void) | undefined;
  onFilter?: ((field: string) => void) | undefined;
  onGroup?: ((field: string) => void) | undefined;
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

  // What "Add column" can offer: what Options › Fields offers, less what shows.
  const shown = new Set(columns.map((column) => column.field));
  const addable = [
    ...SYSTEM_FIELD_CATALOG.filter((field) => field.isColumn).map((field) => field.key as string),
    ...(metadata?.customFields ?? [])
      .filter((field) => !field.isArchived)
      .map((field) => `custom:${field.id}`),
  ]
    .filter((field) => !shown.has(field))
    .map((field) => ({ field, label: columnLabel(field, metadata) }));

  const actionsFor = (column: ViewColumn, index: number): ColumnMenuActions => {
    const field = column.field;
    const queryable = findQueryableField(field, metadata);
    // The Task column, as Asana's Name column, only sorts.
    const isTitle = isFixedColumn(field);
    const arrange = canEdit && !isTitle;

    return {
      // Only a custom field has a definition to edit; the system columns are
      // furniture with nothing to configure.
      onEditField:
        canEdit && onEditField && field.startsWith('custom:')
          ? () => onEditField(field.slice('custom:'.length))
          : undefined,
      onSort: queryable?.isSortable && onSort ? (direction) => onSort(field, direction) : undefined,
      onFilter: !isTitle && queryable?.isFilterable && onFilter ? () => onFilter(field) : undefined,
      onGroup: !isTitle && queryable?.isGroupable && onGroup ? () => onGroup(field) : undefined,
      addable,
      onAdd: arrange ? (added) => onChange(insertColumnAfter(columns, field, added)) : undefined,
      onMove: arrange
        ? (direction) => onChange(moveColumn(columns, field, index + direction))
        : undefined,
      canMoveLeft: index > 0 && !isFixedColumn(columns[index - 1]?.field ?? ''),
      canMoveRight: index < columns.length - 1,
      isPinned: isPinnedColumn(column),
      onPin: arrange ? (isPinned) => onChange(setPinned(columns, field, isPinned)) : undefined,
      onHide: arrange ? () => onChange(toggleColumn(columns, field)) : undefined,
    };
  };

  const body = columns.map((column, index) => (
    <HeaderCell
      key={column.field}
      column={column}
      label={columnLabel(column.field, metadata)}
      canEdit={canEdit}
      pinned={pinned}
      minWidth={
        isFixedColumn(column.field) ? titleMinWidth : columnMinWidth(column.field, metadata)
      }
      actions={actionsFor(column, index)}
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
  minWidth,
  actions,
  onResizePreview,
  onResizeEnd,
}: {
  column: ViewColumn;
  label: string;
  canEdit: boolean;
  pinned: PinnedProps;
  minWidth?: number | undefined;
  actions: ColumnMenuActions;
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
        // Padded on both sides vertically: the grid's top rule sits directly
        // above, and a label flush against it reads as underlining the toolbar.
        'group/header border-r border-border/60 px-3 py-1.5 text-xs font-medium text-muted-foreground',
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
          // A narrow column clips its label, and the only other way to read a
          // clipped one is to resize the column. Hover answers it in place.
          title={label}
          className={cn('flex-1 truncate', canArrange && 'cursor-grab active:cursor-grabbing')}
        >
          {label}
        </span>

        {/* A pinned column keeps its pin in sight: it is state, not a hover action. */}
        {canArrange && isPinnedColumn(column) && (
          <button
            type="button"
            onClick={() => actions.onPin?.(false)}
            aria-label={`Unpin ${label}`}
            aria-pressed
            className="shrink-0 cursor-pointer rounded p-0.5 text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
          >
            <Pin className="size-3" aria-hidden="true" />
          </button>
        )}

        <ColumnMenu label={label} actions={actions} />

        {canEdit && (
          <ResizeHandle
            field={column.field}
            label={label}
            minWidth={minWidth}
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
  field,
  label,
  minWidth,
  startWidth,
  onPreview,
  onEnd,
}: {
  field: string;
  label: string;
  minWidth?: number | undefined;
  startWidth: number;
  onPreview: (width: number) => void;
  onEnd: (width: number) => void;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  const widthAt = (clientX: number) => {
    const from = drag.current;
    if (!from) return startWidth;
    return Math.max(minWidth ?? 0, clampWidth(from.width + (clientX - from.x), field));
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
