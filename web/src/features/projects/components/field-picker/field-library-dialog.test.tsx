import { CustomFieldType, SystemField } from '@coretask/contracts';
import type { CatalogCustomField, FieldCatalog } from '@coretask/types';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { FieldLibraryDialog } from './field-library-dialog';

const catalogState: { data: FieldCatalog | undefined; isLoading: boolean; isError: boolean } = {
  data: undefined,
  isLoading: false,
  isError: false,
};

const attachMutate = vi.fn();
const refetch = vi.fn();

vi.mock('../../hooks/use-project-views', () => ({
  useFieldCatalog: () => ({ ...catalogState, refetch }),
  useAttachField: () => ({ mutate: attachMutate, isPending: false }),
  useCreateCustomField: () => ({ mutate: vi.fn(), isPending: false }),
}));

const field = (overrides: Partial<CatalogCustomField>): CatalogCustomField => ({
  id: 'f-1',
  name: 'Risk',
  description: null,
  type: CustomFieldType.SINGLE_SELECT,
  optionPreview: [],
  usageCount: 1,
  isInProject: false,
  isArchived: false,
  ...overrides,
});

const catalog = (
  projectFields: CatalogCustomField[] = [],
  libraryFields: CatalogCustomField[] = [],
): FieldCatalog => ({ fieldTypes: [], systemFields: [], projectFields, libraryFields });

const open = (options: { columns?: string[] } = {}) => {
  const onAddColumn = vi.fn();
  const onCreateNew = vi.fn();
  const onOpenChange = vi.fn();

  renderWithProviders(
    <FieldLibraryDialog
      columns={(options.columns ?? [SystemField.TITLE]).map((entry) => ({ field: entry }))}
      workspaceId="ws-1"
      projectId="p-1"
      onOpenChange={onOpenChange}
      onAddColumn={onAddColumn}
      onCreateNew={onCreateNew}
    />,
  );

  return { onAddColumn, onCreateNew, onOpenChange };
};

beforeEach(() => {
  catalogState.data = catalog();
  catalogState.isLoading = false;
  catalogState.isError = false;
  attachMutate.mockReset();
  refetch.mockReset();
});

describe('FieldLibraryDialog', () => {
  it('separates what this project uses from the rest of the workspace', () => {
    catalogState.data = catalog(
      [field({ id: 'f-1', name: 'Risk', isInProject: true })],
      [field({ id: 'f-2', name: 'Team' })],
    );

    open();

    const mine = screen.getByRole('region', { name: 'Used by this project' });
    expect(within(mine).getByText('Risk')).toBeInTheDocument();

    const theirs = screen.getByRole('region', { name: 'Elsewhere in the workspace' });
    expect(within(theirs).getByText('Team')).toBeInTheDocument();
  });

  it('offers the action that fits where the field stands', () => {
    // The same field means a different action in each state, and an action
    // whose effect you cannot predict is worse than no action.
    catalogState.data = catalog(
      [field({ id: 'f-1', name: 'Risk', isInProject: true })],
      [field({ id: 'f-2', name: 'Team' })],
    );

    open();

    expect(screen.getByRole('button', { name: 'Add to view' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to project' })).toBeInTheDocument();
  });

  it('shows a field already in the view as done rather than offering it again', () => {
    catalogState.data = catalog([field({ id: 'f-1', name: 'Risk', isInProject: true })]);

    open({ columns: [SystemField.TITLE, 'custom:f-1'] });

    expect(screen.getByText('In this view')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add to view' })).not.toBeInTheDocument();
  });

  it('adds a column directly when the project already has the field', () => {
    catalogState.data = catalog([field({ id: 'f-1', isInProject: true })]);

    const { onAddColumn } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Add to view' }));

    // No attach: it is already here, and attaching again would 409.
    expect(attachMutate).not.toHaveBeenCalled();
    expect(onAddColumn).toHaveBeenCalledWith('custom:f-1');
  });

  it('attaches before adding a column for a field from elsewhere', () => {
    catalogState.data = catalog([], [field({ id: 'f-2' })]);

    const { onAddColumn } = open();
    fireEvent.click(screen.getByRole('button', { name: 'Add to project' }));

    expect(attachMutate).toHaveBeenCalledWith('f-2', expect.anything());
    expect(onAddColumn).not.toHaveBeenCalled();

    const [, handlers] = attachMutate.mock.calls[0];
    handlers.onSuccess();
    expect(onAddColumn).toHaveBeenCalledWith('custom:f-2');
  });

  it('lists archived fields without offering to use them', () => {
    // Visible so somebody can see why a name is "taken"; not actionable,
    // because restoring is a field-management decision.
    catalogState.data = catalog([], [field({ id: 'f-3', name: 'Old', isArchived: true })]);

    open();

    const archived = screen.getByRole('region', { name: 'Archived' });
    expect(within(archived).getByText('Old')).toBeInTheDocument();
    expect(within(archived).queryByRole('button')).not.toBeInTheDocument();
  });

  it('previews the options, because a name alone does not identify a field', () => {
    catalogState.data = catalog(
      [],
      [
        field({
          optionPreview: [
            { id: 'o-1', label: 'Low', colorToken: 'blue' },
            { id: 'o-2', label: 'High', colorToken: 'red' },
          ],
        }),
      ],
    );

    open();

    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });

  it('says how widely a field is used', () => {
    catalogState.data = catalog([], [field({ usageCount: 3 })]);

    open();

    expect(screen.getByText('3 projects')).toBeInTheDocument();
  });

  it('offers to create the first field when the library is empty', () => {
    const { onCreateNew } = open();

    expect(screen.getByText('The workspace has no reusable fields yet.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Create the first one/ }));
    expect(onCreateNew).toHaveBeenCalled();
  });

  it('offers a retry when the library fails to load', () => {
    catalogState.data = undefined;
    catalogState.isError = true;

    open();

    expect(screen.getByText('Could not load the library.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it('says so while the library is loading', () => {
    catalogState.data = undefined;
    catalogState.isLoading = true;

    open();

    expect(screen.getByText('Loading the library…')).toBeInTheDocument();
  });

  it('hands off to the builder from the footer', () => {
    catalogState.data = catalog([], [field({})]);

    const { onCreateNew } = open();
    fireEvent.click(screen.getByRole('button', { name: /Create new field/ }));

    expect(onCreateNew).toHaveBeenCalled();
  });
});
