import type { AutomationRuleVersionSummary } from '@coretask/types';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, userEvent } from '@/test/test-utils';

import { VersionHistoryDialog } from './version-history-dialog';

const versions = vi.fn();

vi.mock('../../api/automations.api', () => ({
  automationsApi: { versions: (...args: unknown[]) => versions(...args) },
}));

const version = (number: number, isPublished: boolean): AutomationRuleVersionSummary => ({
  id: `v-${number}`,
  version: number,
  name: number === 1 ? 'Old name' : 'Assign on arrival',
  triggerType: 'TASK_MOVED_TO_SECTION',
  publishedAt: new Date(Date.now() - number * 60_000).toISOString(),
  publishedBy: { id: 'u-1', name: 'Dana', avatarUrl: null },
  isPublished,
  stepCount: number,
});

const open = (hasUnpublishedChanges: boolean) => {
  const onRestore = vi.fn().mockResolvedValue(undefined);
  versions.mockResolvedValue([version(2, true), version(1, false)]);

  renderWithProviders(
    <VersionHistoryDialog
      open
      onOpenChange={() => {}}
      workspaceId="ws-1"
      projectId="p-1"
      ruleId="rule-1"
      ruleName="Assign on arrival"
      hasUnpublishedChanges={hasUnpublishedChanges}
      restoring={false}
      onRestore={onRestore}
    />,
  );

  return onRestore;
};

describe('VersionHistoryDialog', () => {
  it('lists versions newest first, marks the running one, and offers the others back', async () => {
    open(false);

    expect(await screen.findByText('Version 2')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    // Only an older version can be restored; the running one already is.
    expect(screen.getAllByRole('button', { name: /Restore version/ })).toHaveLength(1);
    // A name is worth showing only when the rule no longer has it.
    expect(screen.getByText(/as “Old name”/)).toBeInTheDocument();
    expect(screen.queryByText(/as “Assign on arrival”/)).not.toBeInTheDocument();
  });

  it('restores straight away when nothing unpublished would be lost', async () => {
    const onRestore = open(false);

    await userEvent.click(await screen.findByRole('button', { name: 'Restore version 1' }));

    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));
  });

  it('asks first when the restore would replace unpublished changes', async () => {
    const onRestore = open(true);

    await userEvent.click(await screen.findByRole('button', { name: 'Restore version 1' }));
    expect(onRestore).not.toHaveBeenCalled();
    expect(await screen.findByText('Restore version 1?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ version: 1 }));
  });

  it('discards unpublished changes by going back to the running version', async () => {
    const onRestore = open(true);

    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));

    expect(onRestore).toHaveBeenCalledWith(
      expect.objectContaining({ version: 2, isPublished: true }),
    );
  });
});
