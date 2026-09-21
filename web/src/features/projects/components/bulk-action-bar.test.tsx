import { CustomFieldType } from '@coretask/contracts';
import type { CustomField } from '@coretask/types';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BulkActionBar } from './bulk-action-bar';

const members = [
  { id: 'u-1', name: 'Ada Lovelace', avatarUrl: null },
  { id: 'u-2', name: 'Grace Hopper', avatarUrl: null },
];
const sections = [
  { id: 's-1', name: 'To do' },
  { id: 's-2', name: 'Doing' },
];

const field = (overrides: Partial<CustomField>): CustomField => ({
  id: 'f-1',
  projectId: 'p-1',
  name: 'Effort',
  description: null,
  type: CustomFieldType.NUMBER,
  isRequired: false,
  notifyOnChange: false,
  isArchived: false,
  position: 1,
  settings: {},
  options: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

function renderBar(overrides: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) {
  const handlers = {
    onAssign: vi.fn(),
    onSchedule: vi.fn(),
    onStatus: vi.fn(),
    onPriority: vi.fn(),
    onMove: vi.fn(),
    onFieldValue: vi.fn(),
    onArchive: vi.fn(),
    onClear: vi.fn(),
  };
  render(
    <BulkActionBar
      count={3}
      members={members}
      sections={sections}
      hasTicket={false}
      taskCount={3}
      fields={[field({})]}
      metadata={undefined}
      canArchive
      pending={false}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('BulkActionBar', () => {
  it('says how many rows it acts on and can let them go', () => {
    const { onClear } = renderBar();

    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent('3 selected');
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('greys out the task vocabularies once a ticket is in the selection', () => {
    renderBar({ hasTicket: true });

    expect(screen.getByRole('combobox', { name: 'Status' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Priority' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeEnabled();
  });

  it('offers Archive only to those who may archive', () => {
    renderBar({ canArchive: false });

    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });

  it('confirms before archiving, then fires once', () => {
    const { onArchive } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Archive 3 tasks?');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect(onArchive).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('sets a field value in two steps: the field, then its value', () => {
    const { onFieldValue } = renderBar();

    fireEvent.click(screen.getByRole('button', { name: 'Fields' }));
    fireEvent.click(screen.getByRole('option', { name: /Effort/ }));

    // The grid's own editor, already open: the bulk edit is the cell edit.
    const input = screen.getByRole('spinbutton', { name: /Effort for/ });
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onFieldValue).toHaveBeenCalledWith(expect.objectContaining({ id: 'f-1' }), {
      number: 5,
    });
  });

  it('leaves out fields nobody can set', () => {
    renderBar({
      fields: [
        field({ id: 'f-1', name: 'Effort' }),
        field({ id: 'f-2', name: 'Total', type: CustomFieldType.FORMULA }),
        field({ id: 'f-3', name: 'Old', isArchived: true }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Fields' }));

    expect(screen.getByRole('option', { name: /Effort/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Total/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Old/ })).not.toBeInTheDocument();
  });

  it('greys the Fields pill when only tickets are selected', () => {
    renderBar({ hasTicket: true, taskCount: 0 });

    expect(screen.getByRole('button', { name: 'Fields' })).toBeDisabled();
  });
});
