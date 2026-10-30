import type { ProjectFieldMetadata, ViewColumn } from '@coretask/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { ColumnHeaderTable } from './column-header';

const priority = {
  id: 'f-priority',
  name: 'Priority',
  type: 'SINGLE_SELECT',
  isArchived: false,
  options: [],
} as unknown as ProjectFieldMetadata['customFields'][number];

const metadata = {
  customFields: [priority],
  statuses: [],
  priorities: [],
  sections: [],
  members: [],
  assignees: [],
  tags: [],
} as unknown as ProjectFieldMetadata;

const columns: ViewColumn[] = [
  { field: 'title' },
  { field: 'assigneeId' },
  { field: 'custom:f-priority' },
];

function renderHeader(overrides: Partial<React.ComponentProps<typeof ColumnHeaderTable>> = {}) {
  const props = {
    columns,
    metadata,
    canEdit: true,
    pinned: { offsets: new Map<string, number>(), lastPinned: null },
    onChange: vi.fn(),
    onResizePreview: vi.fn(),
    addControl: null,
    widths: null,
    onEditField: vi.fn(),
    onSort: vi.fn(),
    onFilter: vi.fn(),
    onGroup: vi.fn(),
    ...overrides,
  };
  render(<ColumnHeaderTable {...props} />);
  return props;
}

describe('a column’s menu', () => {
  it('offers what Asana’s offers for a custom field', async () => {
    const user = setupUser();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Show options for Priority column' }));

    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toEqual([
      'Edit field',
      'Sort',
      'Filter',
      'Group',
      'Add column',
      'Move column',
      'Pin column',
      'Hide column',
    ]);
  });

  it('edits, filters, groups and hides through the view', async () => {
    const user = setupUser();
    const props = renderHeader();
    const open = () =>
      user.click(screen.getByRole('button', { name: 'Show options for Priority column' }));

    await open();
    await user.click(screen.getByRole('menuitem', { name: 'Edit field' }));
    expect(props.onEditField).toHaveBeenCalledWith('f-priority');

    await open();
    await user.click(screen.getByRole('menuitem', { name: 'Filter' }));
    expect(props.onFilter).toHaveBeenCalledWith('custom:f-priority');

    await open();
    screen.getByRole('menuitem', { name: 'Group' }).focus();
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: 'Group descending' }));
    expect(props.onGroup).toHaveBeenCalledWith('custom:f-priority', 'DESC');

    await open();
    await user.click(screen.getByRole('menuitem', { name: 'Hide column' }));
    expect(props.onChange).toHaveBeenCalledWith([{ field: 'title' }, { field: 'assigneeId' }]);
  });

  it('adds an automation to the field and deletes it, as Asana’s menu ends', async () => {
    const user = setupUser();
    const onAddAutomation = vi.fn();
    const onDeleteField = vi.fn();
    renderHeader({ onAddAutomation, onDeleteField });
    const open = () =>
      user.click(screen.getByRole('button', { name: 'Show options for Priority column' }));

    await open();
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items.slice(-2)).toEqual(['Add automation to field', 'Delete field']);

    await user.click(screen.getByRole('menuitem', { name: 'Add automation to field' }));
    expect(onAddAutomation).toHaveBeenCalledWith('f-priority');

    await open();
    await user.click(screen.getByRole('menuitem', { name: 'Delete field' }));
    expect(onDeleteField).toHaveBeenCalledWith('f-priority');
  });

  it('offers neither on a column that is not a custom field', async () => {
    const user = setupUser();
    renderHeader({ onAddAutomation: vi.fn(), onDeleteField: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Show options for Assignee column' }));

    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).not.toContain('Delete field');
    expect(items).not.toContain('Add automation to field');
  });

  it('finds and replaces on the Assignee column, and on no other', async () => {
    const user = setupUser();
    const onReplaceAssignee = vi.fn();
    renderHeader({ onReplaceAssignee });

    await user.click(screen.getByRole('button', { name: 'Show options for Assignee column' }));
    expect(screen.getAllByRole('menuitem')[0]).toHaveTextContent('Find and replace assignee');
    await user.click(screen.getByRole('menuitem', { name: 'Find and replace assignee' }));
    expect(onReplaceAssignee).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Show options for Priority column' }));
    expect(
      screen.queryByRole('menuitem', { name: 'Find and replace assignee' }),
    ).not.toBeInTheDocument();
  });

  it('keeps find and replace from someone who cannot edit', async () => {
    const user = setupUser();
    renderHeader({ canEdit: false, onReplaceAssignee: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Show options for Assignee column' }));

    expect(
      screen.queryByRole('menuitem', { name: 'Find and replace assignee' }),
    ).not.toBeInTheDocument();
  });

  it('sorts by the column, either way', async () => {
    const user = setupUser();
    const props = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Show options for Priority column' }));
    // A submenu opens to the right, as Radix does it from the keyboard.
    screen.getByRole('menuitem', { name: 'Sort' }).focus();
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: 'Sort descending' }));

    expect(props.onSort).toHaveBeenCalledWith('custom:f-priority', 'DESC');
  });

  it('only sorts by the Name column, which never moves or hides', async () => {
    const user = setupUser();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Show options for Name column' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Sort']);
  });

  it('keeps a viewer to the view’s own settings', async () => {
    const user = setupUser();
    renderHeader({ canEdit: false });

    await user.click(screen.getByRole('button', { name: 'Show options for Priority column' }));

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Sort',
      'Filter',
      'Group',
    ]);
  });
});
