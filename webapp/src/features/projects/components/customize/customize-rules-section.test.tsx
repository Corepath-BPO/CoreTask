import { describe, expect, it, vi } from 'vitest';

import type { AutomationRule } from '@/features/automations/api/automations.api';
import { renderWithRouter, screen, setupUser, within } from '@/test/test-utils';

import { CustomizeRulesSection } from './customize-rules-section';

// Only Save to library reads the project's names, and no test here saves one.
vi.mock('@/features/automations/builder/hooks/use-automation-graph', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAutomationMetadata: () => ({ data: undefined, isLoading: false }),
}));

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const rule = (over: Partial<AutomationRule>) =>
  ({
    id: 'rule-1',
    projectId: 'p-1',
    name: 'Rule',
    description: null,
    status: 'ACTIVE',
    triggerType: 'TASK_MOVED_TO_SECTION',
    triggerConfig: {},
    nodes: [],
    createdBy: null,
    lastRunAt: null,
    lastRunStatus: null,
    runCount: 0,
    failureCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  }) as AutomationRule;

const rules = [
  rule({
    id: 'r-1',
    name: 'Move to Prepare New Lease',
    lastRunAt: hoursAgo(3),
    lastRunStatus: 'COMPLETED',
    runCount: 4,
  }),
  rule({
    id: 'r-2',
    name: 'Assign the inspector',
    status: 'PAUSED',
    lastRunAt: hoursAgo(2),
    lastRunStatus: 'FAILED',
    runCount: 2,
  }),
  rule({ id: 'r-3', name: 'Due Monday next week', status: 'DRAFT', bundleId: 'b-1' }),
];

const renderSection = (canManage = true) =>
  renderWithRouter(() => (
    <CustomizeRulesSection
      workspaceId="ws-1"
      projectId="p-1"
      rules={rules}
      isLoading={false}
      canManage={canManage}
    />
  ));

describe('CustomizeRulesSection', () => {
  it('lists each rule with whether it is on and when it last ran', async () => {
    await renderSection();

    expect(screen.getByRole('heading', { name: 'In this project' })).toBeInTheDocument();
    expect(screen.getByText('Triggered by activity in this project')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /^Move to Prepare New Lease/ })).toHaveTextContent(
      'Active · Last run 3 hours ago',
    );
    expect(screen.getByRole('button', { name: /^Due Monday next week/ })).toHaveTextContent(
      'Draft · Never run · From a bundle',
    );
  });

  it('says when the last run failed', async () => {
    await renderSection();

    const failed = screen.getByText(/Last run failed/);
    expect(failed).toHaveTextContent('Last run failed 2 hours ago');
    expect(failed).toHaveClass('text-destructive');
    expect(screen.getByRole('button', { name: /^Assign the inspector/ })).toHaveTextContent(
      /^Assign the inspectorPaused/,
    );
  });

  it('adds a rule from scratch or from the library', async () => {
    const user = setupUser();
    await renderSection();

    await user.click(screen.getByRole('button', { name: 'Add' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Start from scratch', 'Start from the rule library']);
  });

  it('gives each rule its own ⋯ menu, named for what removing it does', async () => {
    const user = setupUser();
    await renderSection();

    await user.click(screen.getByRole('button', { name: 'Actions for Assign the inspector' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Edit rule', 'Run history', 'Resume', 'Duplicate', 'Save to library', 'Archive']);

    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Actions for Due Monday next week' }));
    expect(await screen.findByRole('menuitem', { name: 'Publish' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();
  });

  it('asks before archiving a rule that has run', async () => {
    const user = setupUser();
    await renderSection();

    await user.click(screen.getByRole('button', { name: 'Actions for Assign the inspector' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Archive “Assign the inspector”?');
  });

  it('shows neither Add nor ⋯ to somebody who cannot manage rules', async () => {
    await renderSection(false);

    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
    // Opening a rule to read it still works.
    expect(screen.getByRole('button', { name: /^Move to Prepare New Lease/ })).toBeEnabled();
  });
});
