import { SystemField } from '@coretask/contracts';
import type { ViewColumn } from '@coretask/types';

/*
 * Splitting sections into separate tables means each one would otherwise size
 * its own columns from its own content, so a card holding short titles would
 * not line up with the card above it. Every table declares the same widths and
 * `table-fixed`, which makes the stack read as one grid.
 */
const DEFAULT_COLUMN_WIDTH = 150;

const COLUMN_WIDTHS: Record<string, number> = {
  [SystemField.TITLE]: 300,
  [SystemField.ASSIGNEE]: 170,
  [SystemField.STATUS]: 140,
  [SystemField.PRIORITY]: 130,
  [SystemField.DUE_DATE]: 130,
  [SystemField.START_DATE]: 130,
  [SystemField.ESTIMATE]: 120,
};

/*
 * The same bounds the API enforces on a saved view. Duplicated deliberately: a
 * drag that could travel past them would be rejected on save, and a column that
 * snaps back after you let go is worse than one that stops under the cursor.
 */
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 800;

/** The `+` control's column, which every table declares. */
export const ADD_COLUMN_WIDTH = 44;

/**
 * The columns a view can actually show, out of the ones it names.
 *
 * A saved view outlives what it points at. Two things get dropped:
 *
 *   * `SECTION`, because every row already sits inside a card headed by its
 *     section, so the column repeats that down the page for a column's width;
 *   * any custom field that no longer exists, because a column of dashes under
 *     a header reading "Deleted field" is worse than no column at all.
 *
 * Custom columns survive while `metadata` is undefined. Nothing is known to
 * exist during loading, and filtering then would drop every custom column and
 * put it back a moment later.
 *
 * Filtered rather than written back: a view is presentation, and rewriting
 * stored settings would decide on somebody's behalf that a field is gone for
 * good — when an archived field can be restored.
 */
export function visibleColumns(
  columns: ViewColumn[],
  metadata: { customFields: { id: string }[] } | undefined,
): ViewColumn[] {
  const live = new Set((metadata?.customFields ?? []).map((field) => `custom:${field.id}`));

  return columns.filter((column) => {
    if (column.field === SystemField.SECTION) return false;
    if (!metadata || !column.field.startsWith('custom:')) return true;
    return live.has(column.field);
  });
}

export function columnWidth(column: ViewColumn): number {
  return column.width ?? COLUMN_WIDTHS[column.field] ?? DEFAULT_COLUMN_WIDTH;
}

/**
 * The Task column's own floor. It holds the expander, the drag handle and the
 * only text identifying the row — at the general 60px minimum a drag can
 * crush it into a sliver of nothing, so it stops earlier.
 */
export const MIN_TITLE_WIDTH = 200;

export function clampWidth(width: number, field?: string): number {
  const min = field && isFixedColumn(field) ? MIN_TITLE_WIDTH : MIN_COLUMN_WIDTH;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(min, Math.round(width)));
}

/**
 * The Task column, which is furniture rather than a column somebody arranged.
 *
 * It is what every other cell in the row is *about*: unpinned it scrolls away
 * and the row loses the only thing identifying it, and moved out of first place
 * it reads as another attribute of a task the grid no longer names. So it does
 * not move and does not unpin — not by drag, not by the pin control, and not by
 * a stored setting that says otherwise.
 */
export function isFixedColumn(field: string): boolean {
  return field === SystemField.TITLE;
}

/**
 * Whether a column is frozen.
 *
 * The Task column is frozen outright — see `isFixedColumn`. For the rest, an
 * absent `isPinned` means not pinned, which is what every view saved before
 * pinning existed intends.
 */
export function isPinnedColumn(column: ViewColumn): boolean {
  return isFixedColumn(column.field) || (column.isPinned ?? false);
}

export interface PinnedLayout {
  /** Left offset in pixels, for pinned columns only. */
  offsets: Map<string, number>;
  /** The column that grows a shadow once the grid is scrolled sideways. */
  lastPinned: string | null;
  totalWidth: number;
}

/**
 * Where each pinned column sits, and how wide the whole grid is.
 *
 * A pinned column's `left` is the sum of the pinned columns before it, which is
 * only meaningful while the pinned block is contiguous and leading — see
 * `setPinned`, which is what keeps it that way.
 */
export function pinnedLayout(columns: ViewColumn[]): PinnedLayout {
  const offsets = new Map<string, number>();
  let offset = 0;
  let lastPinned: string | null = null;

  for (const column of columns) {
    if (!isPinnedColumn(column)) break;

    offsets.set(column.field, offset);
    offset += columnWidth(column);
    lastPinned = column.field;
  }

  const totalWidth = columns.reduce((sum, column) => sum + columnWidth(column), ADD_COLUMN_WIDTH);

  return { offsets, lastPinned, totalWidth };
}

/**
 * Pins or unpins a column, keeping the pinned block leading and contiguous.
 *
 * Pinning moves the column to the end of that block rather than freezing it
 * where it stands. A pinned column with unpinned ones to its left has nowhere
 * honest to stick: it would either overlap them as they scroll underneath, or
 * leave a gap. Hoisting it is the only arrangement where "pinned" means what it
 * looks like it means.
 *
 * Unpinning drops the column just past the block, so it stays next to where it
 * was rather than jumping to the far end of a wide grid.
 */
export function setPinned(columns: ViewColumn[], field: string, isPinned: boolean): ViewColumn[] {
  if (isFixedColumn(field)) return columns;

  const target = columns.find((column) => column.field === field);
  if (!target) return columns;

  const rest = columns.filter((column) => column.field !== field);
  const updated = { ...target, isPinned };

  const pinnedCount = rest.findIndex((column) => !isPinnedColumn(column));
  const blockEnd = pinnedCount === -1 ? rest.length : pinnedCount;

  return [...rest.slice(0, blockEnd), updated, ...rest.slice(blockEnd)];
}

/**
 * Moves a column to another index, then repairs the pinned block.
 *
 * A drag can drop an unpinned column into the middle of the pinned ones, or a
 * pinned one past them. Rather than refuse the drop — which reads as the drag
 * having failed — the column lands where it was dropped and its pinned state
 * follows from where that is. Dragging out of the frozen block unpins; dragging
 * into it pins.
 *
 * The fixed columns are the exception at both ends: they cannot be dragged, and
 * nothing can be dropped in front of them.
 */
export function moveColumn(columns: ViewColumn[], field: string, toIndex: number): ViewColumn[] {
  if (isFixedColumn(field)) return columns;

  const from = columns.findIndex((column) => column.field === field);
  if (from === -1 || from === toIndex) return columns;

  const target = columns[from];
  if (!target) return columns;

  const rest = columns.filter((column) => column.field !== field);

  // Never in front of the Task column, however far left the drop landed.
  const firstMovable = rest.findIndex((column) => !isFixedColumn(column.field));
  const floor = firstMovable === -1 ? rest.length : firstMovable;
  const landing = Math.max(floor, Math.min(toIndex, rest.length));

  // How much of the grid is frozen once this column is out of the way. Reading
  // it from the *other* columns is what makes the answer independent of where
  // the dragged one started.
  const firstUnpinned = rest.findIndex((column) => !isPinnedColumn(column));
  const blockSize = firstUnpinned === -1 ? rest.length : firstUnpinned;

  // Landing inside the frozen block pins; landing anywhere after it does not.
  // Deriving the state from the destination is what keeps the block contiguous
  // without having to rewrite the other columns.
  const moved = { ...target, isPinned: landing < blockSize };

  return [...rest.slice(0, landing), moved, ...rest.slice(landing)];
}
