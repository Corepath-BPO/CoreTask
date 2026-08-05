import { CustomFieldType, SystemField } from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata } from '@coretask/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AddFieldControl } from './add-field-control';

const createField = vi.fn();

vi.mock('../hooks/use-project-views', () => ({
  useCreateCustomField: () => ({ mutate: createField, isPending: false }),
}));

const customField = (overrides: Partial<CustomField>): CustomField =>
  ({
    id: 'f-1',
    name: 'Risk level',
    type: CustomFieldType.TEXT,
    options: [],
    ...overrides,
  }) as CustomField;

const metadata = (customFields: CustomField[] = []): ProjectFieldMetadata => ({
  customFields,
  statuses: [],
  priorities: [],
  sections: [],
  members: [],
});

const setup = (options: {
  columns?: string[];
  customFields?: CustomField[];
  onChange?: ReturnType<typeof vi.fn>;
} = {}) => {
  const onChange = options.onChange ?? vi.fn();

  render(
    <AddFieldControl
      columns={(options.columns ?? [SystemField.TITLE]).map((field) => ({ field }))}
      metadata={metadata(options.customFields)}
      workspaceId="ws-1"
      projectId="p-1"
      onChange={onChange}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Add a column' }));
  return onChange;
};

beforeEach(() => createField.mockReset());

describe('AddFieldControl', () => {
  it('offers only fields that are not already columns', () => {
    setup({ columns: [SystemField.TITLE, SystemField.STATUS] });

    expect(screen.getByRole('button', { name: 'Priority' })).toBeInTheDocument();
    // Already a column — offering it again would either duplicate the column or
    // do nothing, and both read as broken.
    expect(screen.queryByRole('button', { name: 'Status' })).not.toBeInTheDocument();
  });

  it('appends the chosen field to the view’s columns', () => {
    const onChange = setup({ columns: [SystemField.TITLE] });

    fireEvent.click(screen.getByRole('button', { name: 'Priority' }));

    expect(onChange).toHaveBeenCalledWith([
      { field: SystemField.TITLE },
      { field: SystemField.PRIORITY },
    ]);
  });

  it('lists the project’s own custom fields, not a hard-coded set', () => {
    setup({ customFields: [customField({ id: 'f-9', name: 'Team' })] });

    expect(screen.getByRole('button', { name: /Team/ })).toBeInTheDocument();
  });

  it('says so when every field is already shown', () => {
    setup({
      columns: [
        SystemField.TITLE,
        SystemField.ASSIGNEE,
        SystemField.PRIORITY,
        SystemField.STATUS,
        SystemField.DUE_DATE,
        SystemField.SECTION,
        SystemField.START_DATE,
        SystemField.COMPLETED_AT,
        SystemField.CREATED_AT,
        SystemField.ESTIMATE,
      ],
    });

    expect(screen.getByText('Every field is already a column.')).toBeInTheDocument();
    // Creating a new one is still on offer — that is the way out of this state.
    expect(screen.getByRole('button', { name: /Create field/ })).toBeInTheDocument();
  });

  it('creates a field and only then adds its column', () => {
    const onChange = setup();

    fireEvent.click(screen.getByRole('button', { name: /Create field/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Risk level' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(createField).toHaveBeenCalledWith(
      { name: 'Risk level', type: CustomFieldType.TEXT },
      expect.anything(),
    );
    // A column pointing at a field that does not exist yet would render an
    // empty cell if the request failed, so the column waits for the id.
    expect(onChange).not.toHaveBeenCalled();

    const [, handlers] = createField.mock.calls[0];
    handlers.onSuccess({ id: 'f-new' });

    expect(onChange).toHaveBeenCalledWith([
      { field: SystemField.TITLE },
      { field: 'custom:f-new' },
    ]);
  });

  it('will not create a field with no name', () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: /Create field/ }));

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('trims the name rather than storing the spaces someone typed', () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: /Create field/ }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Team  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(createField).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Team' }),
      expect.anything(),
    );
  });
});
