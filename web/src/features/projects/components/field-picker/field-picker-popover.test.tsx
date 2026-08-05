import { CustomFieldType, SystemField } from '@coretask/contracts';
import type { FieldCatalog } from '@coretask/types';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { FieldPickerPopover } from './field-picker-popover';

const catalogState: {
  data: FieldCatalog | undefined;
  isLoading: boolean;
  isError: boolean;
} = { data: undefined, isLoading: false, isError: false };

const attachMutate = vi.fn();
const createMutate = vi.fn();
const refetch = vi.fn();

vi.mock('../../hooks/use-project-views', () => ({
  useFieldCatalog: () => ({ ...catalogState, refetch }),
  useAttachField: () => ({ mutate: attachMutate, isPending: false }),
  useCreateCustomField: () => ({ mutate: createMutate, isPending: false }),
}));

const catalog = (overrides: Partial<FieldCatalog> = {}): FieldCatalog => ({
  fieldTypes: [
    {
      type: CustomFieldType.SINGLE_SELECT,
      label: 'Single-select',
      description: 'Choose one coloured option',
      hasOptions: true,
    },
  ],
  systemFields: [
    {
      key: SystemField.ASSIGNEE,
      label: 'Assignee',
      description: 'Who is doing the work',
      dataType: CustomFieldType.PEOPLE,
      isSortable: true,
      isFilterable: true,
      isGroupable: true,
      isEditable: true,
      isInView: false,
    },
  ],
  projectFields: [],
  libraryFields: [],
  ...overrides,
});

const open = async (onChange = vi.fn()) => {
  renderWithProviders(
    <FieldPickerPopover
      columns={[{ field: SystemField.TITLE }]}
      workspaceId="ws-1"
      projectId="p-1"
      onChange={onChange}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
  await waitFor(() => expect(screen.getByLabelText('Search or create a field')).toBeInTheDocument());

  return onChange;
};

beforeEach(() => {
  catalogState.data = catalog();
  catalogState.isLoading = false;
  catalogState.isError = false;
  attachMutate.mockReset();
  createMutate.mockReset();
  refetch.mockReset();
});

describe('FieldPickerPopover', () => {
  it('opens a searchable list from the + control', async () => {
    await open();

    expect(screen.getByText('Field types')).toBeInTheDocument();
    expect(screen.getByText('Single-select')).toBeInTheDocument();
    expect(screen.getByText('Assignee')).toBeInTheDocument();
  });

  it('adds a hidden system field as the last column', async () => {
    const onChange = await open();

    fireEvent.click(screen.getByText('Assignee'));

    expect(onChange).toHaveBeenCalledWith([
      { field: SystemField.TITLE },
      { field: SystemField.ASSIGNEE },
    ]);
  });

  it('shows a field already in the view as present rather than hiding it', async () => {
    // "Already added" and "no such field" look identical if it is omitted.
    catalogState.data = catalog({
      systemFields: [
        {
          key: SystemField.STATUS,
          label: 'Status',
          description: 'Where the task has got to',
          dataType: CustomFieldType.SINGLE_SELECT,
          isSortable: true,
          isFilterable: true,
          isGroupable: true,
          isEditable: true,
          isInView: true,
        },
      ],
    });

    const onChange = await open();

    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('In this view')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Status'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('adds a project field that is not yet a column', async () => {
    catalogState.data = catalog({
      projectFields: [
        {
          id: 'f-1',
          name: 'Risk',
          description: null,
          type: CustomFieldType.TEXT,
          optionPreview: [],
          usageCount: 1,
          isInProject: true,
          isArchived: false,
          isInView: false,
        },
      ],
    });

    const onChange = await open();
    fireEvent.click(screen.getByText('Risk'));

    expect(onChange).toHaveBeenCalledWith([
      { field: SystemField.TITLE },
      { field: 'custom:f-1' },
    ]);
  });

  it('attaches a library field before adding its column', async () => {
    catalogState.data = catalog({
      libraryFields: [
        {
          id: 'f-9',
          name: 'Risk',
          description: null,
          type: CustomFieldType.TEXT,
          optionPreview: [],
          usageCount: 2,
          isInProject: false,
          isArchived: false,
          isInView: false,
        },
      ],
    });

    const onChange = await open();
    fireEvent.click(screen.getByText('Risk'));

    // A column pointing at a field this project does not have would render
    // blank, so the attach has to land first.
    expect(attachMutate).toHaveBeenCalledWith('f-9', expect.anything());
    expect(onChange).not.toHaveBeenCalled();

    const [, handlers] = attachMutate.mock.calls[0];
    handlers.onSuccess();

    expect(onChange).toHaveBeenCalledWith([
      { field: SystemField.TITLE },
      { field: 'custom:f-9' },
    ]);
  });

  it('offers to create a field named after the search term', async () => {
    await open();

    fireEvent.change(screen.getByLabelText('Search or create a field'), {
      target: { value: 'Delivery risk' },
    });

    await waitFor(() =>
      expect(screen.getByText(/Create custom field/)).toBeInTheDocument(),
    );
    expect(screen.getByText('Delivery risk')).toBeInTheDocument();
  });

  it('does not offer to create a field that already exists by that name', async () => {
    catalogState.data = catalog({
      projectFields: [
        {
          id: 'f-1',
          name: 'Risk',
          description: null,
          type: CustomFieldType.TEXT,
          optionPreview: [],
          usageCount: 1,
          isInProject: true,
          isArchived: false,
          isInView: false,
        },
      ],
    });

    await open();
    fireEvent.change(screen.getByLabelText('Search or create a field'), {
      target: { value: 'Risk' },
    });

    await waitFor(() => expect(screen.getByText('Risk')).toBeInTheDocument());
    expect(screen.queryByText(/Create custom field/)).not.toBeInTheDocument();
  });

  it('opens the builder prefilled when a field type is chosen', async () => {
    await open();

    fireEvent.change(screen.getByLabelText('Search or create a field'), {
      target: { value: 'Risk' },
    });
    await waitFor(() => expect(screen.getByText('Single-select')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Single-select'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Risk');
  });

  it('offers a retry when the catalog fails', async () => {
    catalogState.data = undefined;
    catalogState.isError = true;

    await open();

    expect(screen.getByText('Could not load the fields.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(refetch).toHaveBeenCalled();
  });

  it('says so while the catalog is loading', async () => {
    catalogState.data = undefined;
    catalogState.isLoading = true;

    await open();

    expect(screen.getByText('Loading fields…')).toBeInTheDocument();
  });
});
