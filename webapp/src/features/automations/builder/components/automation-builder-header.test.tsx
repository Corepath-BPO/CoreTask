import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import {
  AutomationBuilderHeader,
  type BuilderView,
  type SaveState,
} from './automation-builder-header';

function renderHeader({
  status = 'DRAFT',
  publishedVersion = null,
  hasUnpublishedChanges = false,
  view = 'build',
  activityAvailable = true,
  canTurnOn = true,
  canSave = true,
  save = 'idle',
  canSaveToLibrary = true,
  canBrowseLibrary = true,
  withHistory = false,
  withDelete = false,
}: {
  status?: string;
  publishedVersion?: number | null;
  hasUnpublishedChanges?: boolean;
  view?: BuilderView;
  activityAvailable?: boolean;
  canTurnOn?: boolean;
  canSave?: boolean;
  save?: SaveState;
  canSaveToLibrary?: boolean;
  canBrowseLibrary?: boolean;
  withHistory?: boolean;
  withDelete?: boolean;
} = {}) {
  const handlers = {
    onViewChange: vi.fn(),
    onToggleLive: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    onShowHistory: vi.fn(),
    onDelete: vi.fn(),
    onSaveToLibrary: vi.fn(),
    onBrowseLibrary: vi.fn(),
  };

  render(
    <AutomationBuilderHeader
      projectName="Platform"
      status={status}
      publishedVersion={publishedVersion}
      hasUnpublishedChanges={hasUnpublishedChanges}
      name="Assign incoming work"
      onNameChange={vi.fn()}
      view={view}
      onViewChange={handlers.onViewChange}
      activityAvailable={activityAvailable}
      canTurnOn={canTurnOn}
      toggling={false}
      onToggleLive={handlers.onToggleLive}
      settingsOpen={false}
      onToggleSettings={vi.fn()}
      save={save}
      saving={false}
      canSave={canSave}
      onSave={handlers.onSave}
      issues={[]}
      onFocusIssue={vi.fn()}
      {...(withHistory ? { onShowHistory: handlers.onShowHistory } : {})}
      {...(withDelete ? { onDelete: handlers.onDelete } : {})}
      onSaveToLibrary={handlers.onSaveToLibrary}
      canSaveToLibrary={canSaveToLibrary}
      onBrowseLibrary={handlers.onBrowseLibrary}
      canBrowseLibrary={canBrowseLibrary}
      onClose={handlers.onClose}
    />,
  );

  return handlers;
}

describe('AutomationBuilderHeader', () => {
  it('turns a draft on with the switch beside its name', async () => {
    const user = setupUser();
    const { onToggleLive } = renderHeader();

    const toggle = screen.getByRole('switch', { name: 'Turn this rule on' });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('Draft')).toBeInTheDocument();

    await user.click(toggle);
    expect(onToggleLive).toHaveBeenCalledWith(true);
  });

  it('will not turn on a rule that cannot be published yet', () => {
    renderHeader({ canTurnOn: false });

    expect(screen.getByRole('switch', { name: 'Turn this rule on' })).toBeDisabled();
  });

  it('turns a live rule off, and names the version running', async () => {
    const user = setupUser();
    const { onToggleLive } = renderHeader({
      status: 'ACTIVE',
      publishedVersion: 3,
      canTurnOn: false,
    });

    const toggle = screen.getByRole('switch', { name: 'Turn this rule off' });
    expect(toggle).toBeChecked();
    // Turning a running rule off never waits on it being publishable.
    expect(toggle).toBeEnabled();
    expect(screen.getByText(/Active/)).toHaveTextContent('Active · v3');

    await user.click(toggle);
    expect(onToggleLive).toHaveBeenCalledWith(false);
  });

  it('says a paused rule is paused', () => {
    renderHeader({ status: 'PAUSED', publishedVersion: 2 });

    expect(screen.getByText(/Paused/)).toHaveTextContent('Paused · v2');
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('says when a live rule holds edits that are not running yet', () => {
    renderHeader({ status: 'ACTIVE', publishedVersion: 3, hasUnpublishedChanges: true });

    expect(screen.getByText('Unpublished changes')).toBeInTheDocument();
  });

  it('switches between Build and Activity, but not to the runs of an unsaved rule', async () => {
    const user = setupUser();
    const { onViewChange } = renderHeader();

    expect(screen.getByRole('tab', { name: 'Build' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Activity' }));
    expect(onViewChange).toHaveBeenCalledWith('activity');
  });

  it('keeps Activity off until the rule has been saved', () => {
    renderHeader({ activityAvailable: false });

    expect(screen.getByRole('tab', { name: 'Activity' })).toBeDisabled();
  });

  it('saves with Save and leaves with Cancel', async () => {
    const user = setupUser();
    const { onSave, onClose } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps Save off while there is nothing to save', () => {
    renderHeader({ canSave: false, save: 'saved' });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
  });

  it('gathers history, the library and delete under ⋯', async () => {
    const user = setupUser();
    const { onShowHistory, onDelete } = renderHeader({
      withHistory: true,
      withDelete: true,
      canBrowseLibrary: false,
    });

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual([
      'Version history',
      'Save to library',
      'Browse the library (save first)',
      'Delete this rule',
    ]);
    // Starting from a template leaves this canvas, so not over unsaved work.
    expect(within(menu).getByRole('menuitem', { name: /Browse the library/ })).toHaveAttribute(
      'data-disabled',
    );

    await user.click(within(menu).getByRole('menuitem', { name: 'Version history' }));
    expect(onShowHistory).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete this rule' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('offers no history or delete on a rule that has neither yet', async () => {
    const user = setupUser();
    renderHeader({ canSaveToLibrary: false });

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Version history' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Delete this rule' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Save to library' })).toHaveAttribute(
      'data-disabled',
    );
  });
});
