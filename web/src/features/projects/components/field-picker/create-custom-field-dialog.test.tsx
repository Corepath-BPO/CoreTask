import { CustomFieldType } from '@coretask/contracts';
import type { CatalogCustomField } from '@coretask/types';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/test-utils';

import { CreateCustomFieldDialog } from './create-custom-field-dialog';

const createMutate = vi.fn();

vi.mock('../../hooks/use-project-views', () => ({
  useCreateCustomField: () => ({ mutate: createMutate, isPending: false }),
}));

const libraryField = (overrides: Partial<CatalogCustomField> = {}): CatalogCustomField => ({
  id: 'f-1',
  name: 'Risk',
  description: null,
  type: CustomFieldType.TEXT,
  optionPreview: [],
  usageCount: 2,
  isInProject: false,
  isArchived: false,
  isInView: false,
  ...overrides,
});

const open = (
  props: Partial<Parameters<typeof CreateCustomFieldDialog>[0]> = {},
) => {
  const onCreated = vi.fn();
  const onUseExisting = vi.fn();

  renderWithProviders(
    <CreateCustomFieldDialog
      initialName="Risk"
      workspaceId="ws-1"
      projectId="p-1"
      libraryMatches={[]}
      onOpenChange={vi.fn()}
      onCreated={onCreated}
      onUseExisting={onUseExisting}
      {...props}
    />,
  );

  return { onCreated, onUseExisting };
};

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Create field' }));

beforeEach(() => createMutate.mockReset());

describe('CreateCustomFieldDialog', () => {
  it('opens prefilled with the name the picker had', () => {
    open();

    expect(screen.getByLabelText('Name')).toHaveValue('Risk');
  });

  it('shows the configuration that belongs to the chosen type', () => {
    // A form offering "decimal places" above a checkbox teaches the reader the
    // settings do not mean anything.
    open({ initialType: CustomFieldType.NUMBER });

    expect(screen.getByLabelText('Format')).toBeInTheDocument();
    expect(screen.getByLabelText('Decimal places')).toBeInTheDocument();
    expect(screen.queryByLabelText('Options')).not.toBeInTheDocument();
  });

  it('gives a select an option editor with colours', () => {
    open({ initialType: CustomFieldType.SINGLE_SELECT });

    expect(screen.getByLabelText('Option 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Option 2')).toBeInTheDocument();
    // One swatch per option row, not one for the field.
    expect(screen.getAllByRole('button', { name: /Colour for/ })).toHaveLength(2);
  });

  it('sends the type-specific settings with the field', () => {
    open({ initialType: CustomFieldType.TEXT });

    submit();

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Risk', type: 'TEXT', settings: { textMode: 'SHORT' } }),
      expect.anything(),
    );
  });

  it('sends option labels and colours', () => {
    open({ initialType: CustomFieldType.SINGLE_SELECT });

    fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Low' } });
    fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'High' } });
    submit();

    const [payload] = createMutate.mock.calls[0];
    expect(payload.options).toEqual([
      expect.objectContaining({ label: 'Low' }),
      expect.objectContaining({ label: 'High' }),
    ]);
    expect(payload.options[0].colorToken).toBeTruthy();
  });

  it('will not create a select with no options filled in', () => {
    open({ initialType: CustomFieldType.SINGLE_SELECT });

    expect(screen.getByText('Add at least one option.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create field' })).toBeDisabled();
  });

  it('adds and removes option rows', () => {
    open({ initialType: CustomFieldType.SINGLE_SELECT });

    fireEvent.click(screen.getByRole('button', { name: /Add option/ }));
    expect(screen.getByLabelText('Option 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove option 3' }));
    expect(screen.queryByLabelText('Option 3')).not.toBeInTheDocument();
  });

  it('reorders options without a mouse', () => {
    // A drag handle only a mouse can use would make option order a mouse-only
    // feature, so the buttons have to work.
    open({ initialType: CustomFieldType.SINGLE_SELECT });

    fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Low' } });
    fireEvent.change(screen.getByLabelText('Option 2'), { target: { value: 'High' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move Low down' }));
    submit();

    const [payload] = createMutate.mock.calls[0];
    expect(payload.options.map((option: { label: string }) => option.label)).toEqual(['High', 'Low']);
  });

  it('keeps the options when switching between two select types', () => {
    open({ initialType: CustomFieldType.SINGLE_SELECT });

    fireEvent.change(screen.getByLabelText('Option 1'), { target: { value: 'Low' } });
    fireEvent.click(screen.getByLabelText('Type'));
    fireEvent.click(screen.getByRole('option', { name: /Multi-select/ }));

    expect(screen.getByLabelText('Option 1')).toHaveValue('Low');
  });

  it('offers the existing field rather than refusing a duplicate name', () => {
    // Two projects may legitimately want their own "Status", and the API allows
    // it — but a second definition made by accident is worth preventing.
    const existing = libraryField();
    const { onUseExisting } = open({ libraryMatches: [existing] });

    expect(screen.getByText(/already exists in this workspace/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use the existing field' }));

    expect(onUseExisting).toHaveBeenCalledWith(existing);
    expect(createMutate).not.toHaveBeenCalled();
  });

  it('still allows creating another when the name collides', () => {
    open({ libraryMatches: [libraryField()] });

    expect(screen.getByRole('button', { name: 'Create field' })).toBeEnabled();
  });

  it('reports a number range that cannot contain anything', () => {
    open({ initialType: CustomFieldType.NUMBER });

    fireEvent.change(screen.getByLabelText('Minimum'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Maximum'), { target: { value: '1' } });

    expect(screen.getByText('The minimum cannot be greater than the maximum.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create field' })).toBeDisabled();
  });

  it('hands the new field id back so the caller can add the column', () => {
    const { onCreated } = open();

    submit();
    const [, handlers] = createMutate.mock.calls[0];
    handlers.onSuccess({ id: 'f-new' });

    expect(onCreated).toHaveBeenCalledWith('f-new');
  });

  it('marks a field required only when asked', () => {
    open();

    submit();
    expect(createMutate.mock.calls[0][0].isRequired).toBe(false);

    createMutate.mockReset();
    fireEvent.click(screen.getByRole('checkbox', { name: /Required/ }));
    submit();
    expect(createMutate.mock.calls[0][0].isRequired).toBe(true);
  });

  it('shows the people field its own selection setting', () => {
    open({ initialType: CustomFieldType.PEOPLE });

    const trigger = screen.getByLabelText('Selection');
    expect(within(trigger).getByText('One person')).toBeInTheDocument();
  });
});
