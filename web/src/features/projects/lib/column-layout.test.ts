import { SystemField } from '@coretask/contracts';
import type { ViewColumn } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import {
  ADD_COLUMN_WIDTH,
  clampWidth,
  columnWidth,
  isPinnedColumn,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  moveColumn,
  pinnedLayout,
  setPinned,
} from './column-layout';

/** `a*` is pinned, `b` is not — short names keep the arrangements readable. */
const cols = (spec: string): ViewColumn[] =>
  spec.split(' ').map((token) => ({
    field: token.replace('*', ''),
    width: 100,
    ...(token.endsWith('*') ? { isPinned: true } : {}),
  }));

const shape = (columns: ViewColumn[]) =>
  columns.map((column) => `${column.field}${column.isPinned ? '*' : ''}`).join(' ');

describe('columnWidth', () => {
  it('prefers a stored width over the default', () => {
    expect(columnWidth({ field: 'title', width: 420 })).toBe(420);
  });

  it('falls back to a sensible default for an unknown field', () => {
    expect(columnWidth({ field: 'custom:f-1' })).toBe(150);
  });
});

describe('clampWidth', () => {
  it('holds a drag inside the bounds the API will accept', () => {
    // A drag that could travel past them would be rejected on save, and a
    // column that snaps back after you let go is worse than one that stops.
    expect(clampWidth(10)).toBe(MIN_COLUMN_WIDTH);
    expect(clampWidth(5000)).toBe(MAX_COLUMN_WIDTH);
    expect(clampWidth(212.6)).toBe(213);
  });
});

describe('isPinnedColumn', () => {
  it('freezes the Task column in a view saved before pinning existed', () => {
    // Those views have no `isPinned` at all, and the Task column was hard-coded
    // frozen back then. Anything else silently unfreezes every existing view.
    expect(isPinnedColumn({ field: SystemField.TITLE })).toBe(true);
    expect(isPinnedColumn({ field: SystemField.STATUS })).toBe(false);
  });

  it('lets an explicit choice override the default, in both directions', () => {
    expect(isPinnedColumn({ field: SystemField.TITLE, isPinned: false })).toBe(false);
    expect(isPinnedColumn({ field: SystemField.STATUS, isPinned: true })).toBe(true);
  });

  it('freezes the Task column of an untouched view', () => {
    const { offsets, lastPinned } = pinnedLayout([
      { field: SystemField.TITLE },
      { field: SystemField.STATUS },
    ]);

    expect(offsets.get(SystemField.TITLE)).toBe(0);
    expect(lastPinned).toBe(SystemField.TITLE);
  });
});

describe('pinnedLayout', () => {
  it('stacks pinned columns left to right', () => {
    const { offsets, lastPinned } = pinnedLayout(cols('a* b* c'));

    expect(offsets.get('a')).toBe(0);
    expect(offsets.get('b')).toBe(100);
    expect(offsets.has('c')).toBe(false);
    expect(lastPinned).toBe('b');
  });

  it('stops at the first unpinned column', () => {
    // A pinned column behind an unpinned one has no honest offset, so it is not
    // treated as pinned at all rather than being given a wrong one.
    const { offsets, lastPinned } = pinnedLayout(cols('a* b c*'));

    expect(offsets.has('c')).toBe(false);
    expect(lastPinned).toBe('a');
  });

  it('counts the add-field column in the total width', () => {
    expect(pinnedLayout(cols('a b')).totalWidth).toBe(200 + ADD_COLUMN_WIDTH);
  });

  it('has no pinned columns to offset when nothing is pinned', () => {
    const { offsets, lastPinned } = pinnedLayout(cols('a b'));

    expect(offsets.size).toBe(0);
    expect(lastPinned).toBeNull();
  });
});

describe('setPinned', () => {
  it('hoists a newly pinned column to the end of the frozen block', () => {
    expect(shape(setPinned(cols('a* b c'), 'c', true))).toBe('a* c* b');
  });

  it('drops an unpinned column just past the block, not to the far end', () => {
    expect(shape(setPinned(cols('a* b* c'), 'a', false))).toBe('b* a c');
  });

  it('leaves the columns alone when the field is not one of them', () => {
    const columns = cols('a* b');
    expect(setPinned(columns, 'nope', true)).toBe(columns);
  });
});

describe('moveColumn', () => {
  it('reorders within the unpinned columns', () => {
    expect(shape(moveColumn(cols('a* b c d'), 'd', 1))).toBe('a* d b c');
  });

  it('pins a column dragged into the frozen block', () => {
    expect(shape(moveColumn(cols('a* b* c'), 'c', 0))).toBe('c* a* b*');
  });

  it('unpins a column dragged out of the frozen block', () => {
    expect(shape(moveColumn(cols('a* b* c'), 'a', 2))).toBe('b* c a');
  });

  it('keeps the frozen block contiguous when a column lands at its front', () => {
    // Dropping something at index 0 must not strand the columns behind it: they
    // stay pinned, and the newcomer joins them.
    const moved = moveColumn(cols('a* b* c'), 'c', 0);
    const { offsets } = pinnedLayout(moved);

    expect(offsets.size).toBe(3);
    expect(offsets.get('c')).toBe(0);
    expect(offsets.get('a')).toBe(100);
    expect(offsets.get('b')).toBe(200);
  });

  it('does nothing when a column is dropped where it already was', () => {
    const columns = cols('a* b c');
    expect(moveColumn(columns, 'b', 1)).toBe(columns);
  });

  it('clamps a drop past the end rather than losing the column', () => {
    expect(shape(moveColumn(cols('a* b c'), 'b', 99))).toBe('a* c b');
  });
});
