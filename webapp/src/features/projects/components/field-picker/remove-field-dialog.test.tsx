import { CustomFieldType } from '@coretask/contracts';
import type { CustomField } from '@coretask/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RemoveFieldDialog } from './remove-field-dialog';

const field: CustomField = {
  id: 'f-1',
  projectId: 'p-1',
  name: 'Severity',
  description: null,
  type: CustomFieldType.SINGLE_SELECT,
  isRequired: false,
  notifyOnChange: false,
  isArchived: false,
  position: 1,
  settings: {},
  options: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('RemoveFieldDialog', () => {
  it('removes from the project by default, keeping the library copy', () => {
    const onConfirm = vi.fn();
    render(
      <RemoveFieldDialog
        field={field}
        usageCount={3}
        pending={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText(/used by 2 other projects/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from project' }));

    expect(onConfirm).toHaveBeenCalledWith('detach');
  });

  it('deletes from the workspace only when that is chosen', () => {
    // The two outcomes used to be one implicit decision; now the person says
    // which they mean, and the button says what it will do.
    const onConfirm = vi.fn();
    render(
      <RemoveFieldDialog
        field={field}
        usageCount={1}
        pending={false}
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /Delete from the workspace/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete field' }));

    expect(onConfirm).toHaveBeenCalledWith('delete');
  });
});
