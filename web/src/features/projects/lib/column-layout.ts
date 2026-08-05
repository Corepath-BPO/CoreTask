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

export function columnWidth(column: ViewColumn): number {
  return column.width ?? COLUMN_WIDTHS[column.field] ?? DEFAULT_COLUMN_WIDTH;
}

export function clampWidth(width: number): number {
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

/**
 * Whether a column is frozen, with the Task column frozen unless told otherwise.
 *
 * Every view saved before pinning existed has no `isPinned` at all, and the
 * Task column was hard-coded frozen back then. Defaulting it here keeps those
 * views looking the way their owners left them without a data migration, and an
 * explicit `false` still unpins it — the default is a starting point, not a rule.
 */
export function isPinnedColumn(column: ViewColumn): boolean {
  return column.isPinned ?? column.field === SystemField.TITLE;
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
export function setPinned(
  columns: ViewColumn[],
  field: string,
  isPinned: boolean,
): ViewColumn[] {
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
 */
export function moveColumn(columns: ViewColumn[], field: string, toIndex: number): ViewColumn[] {
  const from = columns.findIndex((column) => column.field === field);
  if (from === -1 || from === toIndex) return columns;

  const target = columns[from];
  if (!target) return columns;

  const rest = columns.filter((column) => column.field !== field);
  const landing = Math.max(0, Math.min(toIndex, rest.length));

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
