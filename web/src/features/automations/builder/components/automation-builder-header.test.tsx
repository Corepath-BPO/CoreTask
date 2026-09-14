import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AutomationBuilderHeader } from './automation-builder-header';

function renderHeader(canSave = true, canSaveToLibrary = true, canBrowseLibrary = true) {
  const onSave = vi.fn();
  const onSaveToLibrary = vi.fn();
  const onBrowseLibrary = vi.fn();

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
      onSaveToLibrary={onSaveToLibrary}
      canSaveToLibrary={canSaveToLibrary}
      onBrowseLibrary={onBrowseLibrary}
      canBrowseLibrary={canBrowseLibrary}
      onClose={vi.fn()}
    />,
  );

  return { onSave, onSaveToLibrary, onBrowseLibrary };
}

describe('AutomationBuilderHeader', () => {
  it('provides a visible draft save action', () => {
    const { onSave } = renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(onSave).toHaveBeenCalledOnce();
  });

  it('offers the library from the rule itself, off until there is a rule to save', () => {
    const { onSaveToLibrary } = renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    expect(onSaveToLibrary).toHaveBeenCalledOnce();

    renderHeader(true, false);
    expect(screen.getAllByRole('button', { name: 'Save to library' }).at(-1)).toBeDisabled();
  });

  it('opens the library from the canvas, but not over unsaved work', () => {
    const { onBrowseLibrary } = renderHeader();

    fireEvent.click(screen.getByRole('button', { name: 'Browse the rule library' }));
    expect(onBrowseLibrary).toHaveBeenCalledOnce();

    renderHeader(true, true, false);
    expect(
      screen.getAllByRole('button', { name: 'Browse the rule library' }).at(-1),
    ).toBeDisabled();
  });

  it('disables saving until the draft has a valid change', () => {
    renderHeader(false);

    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  });
});
