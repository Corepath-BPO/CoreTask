import { CustomFieldType } from '@coretask/contracts';
import type { ProjectFieldMetadata, ViewSettings } from '@coretask/types';
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { DEFAULT_VIEW_SETTINGS } from '../../lib/view-settings';

import { FilterPopover } from './filter-popover';
import { GroupPopover } from './group-popover';
import { OptionsPopover } from './options-popover';
import { SortPopover } from './sort-popover';

const metadata: ProjectFieldMetadata = {
  customFields: [
    {
      id: 'f-sev',
      projectId: 'p-1',
      name: 'Severity',
      description: null,
      type: CustomFieldType.SINGLE_SELECT,
      isRequired: false,
      notifyOnChange: false,
      isArchived: false,
      position: 1,
      settings: {},
      options: [
        {
          id: 'o-low',
          label: 'Low',
          colorToken: 'blue',
          customColor: null,
          position: 1,
          isArchived: false,
        },
        {
          id: 'o-high',
          label: 'High',
          colorToken: 'red',
          customColor: null,
          position: 2,
          isArchived: false,
        },
      ],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'f-total',
      projectId: 'p-1',
      name: 'Total',
      description: null,
      type: CustomFieldType.FORMULA,
      isRequired: false,
      notifyOnChange: false,
      isArchived: false,
      position: 2,
      settings: { expression: '1' },
      options: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  statuses: [{ id: 'st-1', name: 'To do', category: 'TODO', colorToken: 'gray' }],
  priorities: [],
  sections: [{ id: 's-1', name: 'Backlog' }],
  members: [{ id: 'u-me', name: 'Me', email: 'me@x.dev', avatarUrl: null }],
};

const settings = (overrides: Partial<ViewSettings> = {}): ViewSettings => ({
  ...DEFAULT_VIEW_SETTINGS,
  columns: [{ field: 'title' }, { field: 'assigneeId' }],
  ...overrides,
});

describe('FilterPopover', () => {
  it('turns a quick chip into a condition and shows the count on the button', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <FilterPopover settings={settings()} metadata={metadata} meId="u-me" onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Just my tasks' }));

    expect(onChange).toHaveBeenCalledWith({
      filters: {
        combinator: 'AND',
        conditions: [{ field: 'assigneeId', operator: 'IN', value: ['u-me'] }],
      },
    });
  });

  it('counts the conditions that hold, and clears them all at once', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <FilterPopover
        settings={settings({
          filters: {
            combinator: 'AND',
            conditions: [{ field: 'title', operator: 'CONTAINS', value: 'x' }],
          },
          showCompleted: false,
        })}
        metadata={metadata}
        meId="u-me"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter, 2 active' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(onChange).toHaveBeenCalledWith({
      filters: { combinator: 'AND', conditions: [] },
      showCompleted: true,
    });
  });

  it('adds a row starting from the first filterable field', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <FilterPopover settings={settings()} metadata={metadata} meId="u-me" onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(onChange).toHaveBeenCalledWith({
      filters: { combinator: 'AND', conditions: [{ field: 'title', operator: 'CONTAINS' }] },
    });
  });
});

describe('SortPopover', () => {
  it('adds a sort and offers manual order as the way back', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SortPopover settings={settings()} metadata={metadata} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add sort' }));

    expect(onChange).toHaveBeenCalledWith({ sorts: [{ field: 'title', direction: 'ASC' }] });
  });

  it('clears every sort from the manual-order choice', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <SortPopover
        settings={settings({ sorts: [{ field: 'dueDate', direction: 'DESC' }] })}
        metadata={metadata}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sort, 1 active' }));
    expect(screen.getByText(/Drag to reorder is off/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Manual order' }));

    expect(onChange).toHaveBeenCalledWith({ sorts: [] });
  });
});

describe('GroupPopover', () => {
  it('offers the project’s select field and refuses a date with a reason', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <GroupPopover settings={settings()} metadata={metadata} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    expect(screen.getByRole('radio', { name: 'Due date' })).toBeDisabled();
    // A formula is never offered: nothing can be grouped by a value that is
    // worked out after the rows arrive.
    expect(screen.queryByRole('radio', { name: 'Total' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Severity' }));
    expect(onChange).toHaveBeenCalledWith({ groupBy: 'custom:f-sev' });
  });
});

describe('OptionsPopover', () => {
  it('toggles a column, moves one, and switches density on the List', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <OptionsPopover
        viewType="LIST"
        settings={settings()}
        metadata={metadata}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Due date' }));
    expect(onChange).toHaveBeenLastCalledWith({
      columns: [{ field: 'title' }, { field: 'assigneeId' }, { field: 'dueDate' }],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Move Assignee up' }));
    expect(onChange).toHaveBeenLastCalledWith({
      columns: [{ field: 'assigneeId' }, { field: 'title' }],
    });

    fireEvent.click(screen.getByRole('radio', { name: 'compact' }));
    expect(onChange).toHaveBeenLastCalledWith({ density: 'COMPACT' });

    // The name is the row's identity: always shown, never offered as a toggle.
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Name' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Name down' })).toBeInTheDocument();
  });

  it('chooses card fields on the Board and hides completed rows', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <OptionsPopover
        viewType="BOARD"
        settings={settings()}
        metadata={metadata}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    expect(screen.queryByRole('radiogroup', { name: 'Row density' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Severity' }));
    expect(onChange).toHaveBeenLastCalledWith({ cardFields: ['custom:f-sev'] });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show completed tasks' }));
    expect(onChange).toHaveBeenLastCalledWith({ showCompleted: false });
  });
});
