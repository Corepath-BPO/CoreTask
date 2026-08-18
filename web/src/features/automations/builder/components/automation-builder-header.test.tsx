import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AutomationBuilderHeader } from './automation-builder-header';

function renderHeader(canSave = true) {
  const onSave = vi.fn();

  render(
    <AutomationBuilderHeader
      projectName="Platform"
      status="DRAFT"
      name="Assign incoming work"
      onNameChange={vi.fn()}
      settingsOpen={false}
      onToggleSettings={vi.fn()}
      save="idle"
      saving={false}
      canSave={canSave}
      onSave={onSave}
      issues={[]}
      onFocusIssue={vi.fn()}
      publishing={false}
      canPublish={false}
      onPublish={vi.fn()}
      onClose={vi.fn()}
    />,
  );

  return { onSave };
}

describe('AutomationBuilderHeader', () => {
  it('provides a visible draft save action', () => {
    const { onSave } = renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(onSave).toHaveBeenCalledOnce();
  });

  it('disables saving until the draft has a valid change', () => {
    renderHeader(false);

    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
});
