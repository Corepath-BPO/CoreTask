import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AutomationBuilderHeader, type SaveState } from './automation-builder-header';

function renderHeader(
  canSave = true,
  canSaveToLibrary = true,
  canBrowseLibrary = true,
  {
    autosaves = false,
    status = 'DRAFT',
    save = 'idle',
    publishedVersion = null,
    hasUnpublishedChanges = false,
    canPublish = false,
  }: {
    autosaves?: boolean;
    status?: string;
    save?: SaveState;
    publishedVersion?: number | null;
    hasUnpublishedChanges?: boolean;
    canPublish?: boolean;
  } = {},
) {
  const onSave = vi.fn();
  const onShowHistory = vi.fn();
  const onSaveToLibrary = vi.fn();
  const onBrowseLibrary = vi.fn();

  render(
    <AutomationBuilderHeader
      projectName="Platform"
      status={status}
      publishedVersion={publishedVersion}
      hasUnpublishedChanges={hasUnpublishedChanges}
      {...(publishedVersion !== null ? { onShowHistory } : {})}
      name="Assign incoming work"
      onNameChange={vi.fn()}
      settingsOpen={false}
      onToggleSettings={vi.fn()}
      save={save}
      saving={false}
      canSave={canSave}
      autosaves={autosaves}
      onSave={onSave}
      issues={[]}
      onFocusIssue={vi.fn()}
      publishing={false}
      canPublish={canPublish}
      onPublish={vi.fn()}
      onSaveToLibrary={onSaveToLibrary}
      canSaveToLibrary={canSaveToLibrary}
      onBrowseLibrary={onBrowseLibrary}
      canBrowseLibrary={canBrowseLibrary}
      onClose={vi.fn()}
    />,
  );

  return { onSave, onSaveToLibrary, onBrowseLibrary, onShowHistory };
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

  it('drops the button for a rule that saves itself, until a save fails', () => {
    renderHeader(true, true, true, { autosaves: true, save: 'saved' });
    expect(screen.queryByRole('button', { name: 'Save draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');

    renderHeader(true, true, true, { autosaves: true, save: 'error' });
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  });

  it('names the running version and says when the draft differs from it', () => {
    renderHeader(true, true, true, {
      status: 'ACTIVE',
      autosaves: true,
      save: 'saved',
      publishedVersion: 3,
      hasUnpublishedChanges: true,
      canPublish: true,
    });

    expect(screen.getByText('· v3')).toBeInTheDocument();
    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish changes' })).toBeEnabled();
  });

  it('has nothing to publish while a live rule runs what is on screen', () => {
    renderHeader(true, true, true, { status: 'ACTIVE', autosaves: true, publishedVersion: 2 });

    expect(screen.queryByText('Unpublished changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish changes' })).toBeDisabled();
  });

  it('opens the version history once there is a version', () => {
    const { onShowHistory } = renderHeader(true, true, true, { publishedVersion: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Version history' }));
    expect(onShowHistory).toHaveBeenCalledOnce();

    renderHeader();
    expect(screen.getAllByRole('button', { name: 'Version history' })).toHaveLength(1);
  });

  it('says a paused rule is turned back on by publishing', () => {
    renderHeader(true, true, true, { status: 'PAUSED', publishedVersion: 1, canPublish: true });

    expect(screen.getByRole('button', { name: 'Publish and resume' })).toBeEnabled();
  });
});
