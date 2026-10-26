import type { Bundle, BundleApplyResult } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { describeApply } from '../../hooks/use-bundles';

import { CustomizeBundlesSection } from './customize-bundles-section';

const bundles = vi.fn();
const apply = vi.fn();
const refresh = vi.fn();
const create = vi.fn();

vi.mock('../../hooks/use-bundles', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBundles: (...args: unknown[]) => bundles(...args),
  useApplyBundle: () => ({ mutate: apply, isPending: false }),
  useDetachBundle: () => ({ mutate: vi.fn(), isPending: false }),
  useRefreshBundle: () => ({ mutate: refresh, isPending: false }),
  useDeleteBundle: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateBundle: () => ({ mutate: create, isPending: false }),
}));

const bundle = (over: Partial<Bundle>): Bundle => ({
  id: 'b',
  name: 'Bundle',
  description: null,
  sourceProject: null,
  version: 1,
  sections: [],
  fields: [],
  rules: [],
  taskTemplates: [],
  projects: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

const renderSection = (canManage = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CustomizeBundlesSection
        workspaceId="ws-1"
        projectId="p-1"
        canManage={canManage}
        partCounts={{ SECTIONS: 4, RULES: 2 }}
      />
    </QueryClientProvider>,
  );

beforeEach(() => {
  apply.mockReset();
  refresh.mockReset();
  create.mockReset();
  bundles.mockReturnValue({
    isLoading: false,
    data: [
      bundle({
        id: 'behind',
        name: 'Lease workflow',
        version: 3,
        sections: ['Legal review'],
        rules: [{ name: 'Note legal', live: true }],
        projects: [{ id: 'p-1', name: 'This one', appliedVersion: 2 }],
      }),
      bundle({
        id: 'mine',
        name: 'Intake',
        sourceProject: { id: 'p-1', name: 'This one' },
        projects: [{ id: 'p-2', name: 'Other', appliedVersion: 1 }],
      }),
      bundle({
        id: 'theirs',
        name: 'Move-out',
        sourceProject: { id: 'p-3', name: 'Turnovers' },
        taskTemplates: [{ name: 'Inspect' }],
      }),
    ],
  });
});

describe('CustomizeBundlesSection', () => {
  it('groups the bundles by how they relate to this project, and acts on each', async () => {
    const user = setupUser();
    renderSection();

    const here = screen.getByRole('region', { name: 'On this project' });
    expect(within(here).getByText('Lease workflow')).toBeInTheDocument();
    expect(within(here).getByText('1 section · 1 rule')).toBeInTheDocument();
    expect(within(here).getByText('Update available')).toBeInTheDocument();
    await user.click(within(here).getByRole('button', { name: /Sync/ }));
    expect(apply).toHaveBeenCalledWith('behind');

    const made = screen.getByRole('region', { name: 'Made from this project' });
    expect(within(made).getByText(/On 1 project · version 1/)).toBeInTheDocument();
    await user.click(within(made).getByRole('button', { name: /Send changes out/ }));
    expect(refresh).toHaveBeenCalledWith('mine');

    const others = screen.getByRole('region', { name: 'Add a bundle' });
    expect(within(others).getByText('From Turnovers')).toBeInTheDocument();
    await user.click(within(others).getByRole('button', { name: 'Add' }));
    expect(apply).toHaveBeenCalledWith('theirs');
  });

  it('makes a bundle from this project with the parts left ticked', async () => {
    const user = setupUser();
    renderSection();

    await user.click(screen.getByRole('button', { name: /Make a bundle from this project/ }));
    await user.type(screen.getByLabelText('Bundle name'), 'Lease workflow');
    await user.click(screen.getByRole('checkbox', { name: /Fields/ }));
    await user.click(screen.getByRole('button', { name: 'Make bundle' }));

    expect(create).toHaveBeenCalledWith(
      {
        name: 'Lease workflow',
        description: null,
        sourceProjectId: 'p-1',
        parts: ['SECTIONS', 'RULES', 'TASK_TEMPLATES'],
      },
      expect.anything(),
    );
  });

  it('offers nothing to press to someone who cannot manage the project', () => {
    renderSection(false);
    expect(screen.queryByRole('button', { name: /Make a bundle/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sync/ })).not.toBeInTheDocument();
  });
});

describe('describeApply', () => {
  const result = (over: Partial<BundleApplyResult>): BundleApplyResult => ({
    projectId: 'p',
    sectionsAdded: 0,
    fieldsAdded: 0,
    rulesWritten: 0,
    rulesLive: 0,
    rulesNeedingAttention: [],
    templatesWritten: 0,
    ...over,
  });

  it('says what an apply added, in one line', () => {
    expect(describeApply(result({ sectionsAdded: 1, rulesWritten: 2, rulesLive: 1 }))).toBe(
      'Added 1 section and 2 rules (1 live)',
    );
    expect(describeApply(result({ sectionsAdded: 2, fieldsAdded: 1, templatesWritten: 1 }))).toBe(
      'Added 2 sections, 1 field and 1 task template',
    );
    expect(describeApply(result({}))).toBe('Already up to date');
  });
});
