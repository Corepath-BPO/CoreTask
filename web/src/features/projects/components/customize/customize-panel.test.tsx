import { CustomFieldType, WorkspaceRole } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationRule } from '@/features/automations/api/automations.api';
import { renderWithRouter, screen, userEvent } from '@/test/test-utils';

import { CustomizePanel } from './customize-panel';

/*
 * The two data sources behind the counts, swapped per test. Everything else in
 * the hooks module stays real — the section views lean on mutations that only
 * fire on interaction the tests never perform.
 */
const fieldMetadata = vi.fn();
const automations = vi.fn();

vi.mock('@/features/projects/hooks/use-project-views', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFieldMetadata: (...args: unknown[]) => fieldMetadata(...args),
  // The fields section reads the List view's columns; none exist in the test.
  useProjectViews: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/features/automations/hooks/use-automations', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAutomations: (...args: unknown[]) => automations(...args),
}));

const field = (index: number, isArchived = false) =>
  ({
    id: `field-${index}`,
    projectId: 'p-1',
    name: `Field ${index}`,
    description: null,
    type: CustomFieldType.TEXT,
    isRequired: false,
    isArchived,
    position: index,
    settings: {},
    options: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }) as ProjectFieldMetadata['customFields'][number];

const metadata = {
  customFields: [...Array.from({ length: 7 }, (_, index) => field(index)), field(7, true)],
  statuses: [],
  priorities: [],
  sections: [],
  members: [],
} as unknown as ProjectFieldMetadata;

const rule = (index: number) =>
  ({
    id: `rule-${index}`,
    projectId: 'p-1',
    name: `Rule ${index}`,
    description: null,
    status: 'ACTIVE',
    triggerType: 'TASK_MOVED',
    triggerConfig: {},
    nodes: [],
    createdBy: null,
    lastRunAt: null,
    lastRunStatus: null,
    runCount: 0,
    failureCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }) as AutomationRule;

const rules = Array.from({ length: 11 }, (_, index) => rule(index));

const renderPanel = (props: Partial<Parameters<typeof CustomizePanel>[0]> = {}) => {
  const onClose = vi.fn();
  const result = renderWithRouter(() => (
    <CustomizePanel
      workspaceId="ws-1"
      projectId="p-1"
      role={WorkspaceRole.MANAGER}
      open
      onClose={onClose}
      {...props}
    />
  ));
  return { onClose, result };
};

beforeEach(() => {
  fieldMetadata.mockReturnValue({ data: metadata, isLoading: false });
  automations.mockReturnValue({ data: rules, isLoading: false });
});

describe('CustomizePanel', () => {
  it('lists every feature row under its group', async () => {
    await renderPanel().result;

    expect(screen.getByRole('heading', { name: 'Customize' })).toBeInTheDocument();
    expect(screen.getByText('AI Studio')).toBeInTheDocument();
    expect(screen.getByText('Workflow features')).toBeInTheDocument();

    for (const label of [
      'Rules',
      'Fields',
      'Forms',
      'Emails',
      'Apps',
      'Task types and templates',
      'Bundles',
      'Status templates',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeInTheDocument();
    }
  });

  it('counts the rules, and only the fields that are not archived', async () => {
    await renderPanel().result;

    expect(screen.getByRole('button', { name: /Rules/ })).toHaveTextContent('11');
    expect(screen.getByRole('button', { name: /^Fields/ })).toHaveTextContent('7');
  });

  it('shows no count until the data has arrived', async () => {
    fieldMetadata.mockReturnValue({ data: undefined, isLoading: true });
    automations.mockReturnValue({ data: undefined, isLoading: true });

    await renderPanel().result;

    expect(screen.getByRole('button', { name: /Rules/ })).not.toHaveTextContent(/\d/);
    expect(screen.getByRole('button', { name: /^Fields/ })).not.toHaveTextContent(/\d/);
  });

  it('marks the unbuilt features Soon and refuses their clicks', async () => {
    await renderPanel().result;

    expect(screen.getAllByText('Soon')).toHaveLength(6);
    for (const label of ['Forms', 'Emails', 'Apps', 'Task types and templates', 'Bundles']) {
      expect(screen.getByRole('button', { name: new RegExp(label) })).toBeDisabled();
    }
  });

  it('closes from the header button and from Escape', async () => {
    const user = userEvent.setup();
    const { onClose, result } = renderPanel();
    await result;

    await user.click(screen.getByRole('button', { name: 'Close customize panel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('is inert while closed', async () => {
    await renderPanel({ open: false }).result;

    expect(document.querySelector('aside')).toHaveAttribute('inert');
  });

  it('opens the Fields section and comes back', async () => {
    const user = userEvent.setup();
    await renderPanel().result;

    await user.click(screen.getByRole('button', { name: /^Fields/ }));

    expect(screen.getByRole('heading', { name: 'Fields' })).toBeInTheDocument();
    expect(screen.getByText('Field 0')).toBeInTheDocument();
    // The archived eighth field stays out of the list, as out of the count.
    expect(screen.queryByText('Field 7')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to customize' }));
    expect(screen.getByRole('heading', { name: 'Customize' })).toBeInTheDocument();
  });

  it('opens the Rules section listing every rule', async () => {
    const user = userEvent.setup();
    await renderPanel().result;

    await user.click(screen.getByRole('button', { name: /Rules/ }));

    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument();
    expect(screen.getByText('Rule 0')).toBeInTheDocument();
    expect(screen.getByText('Rule 10')).toBeInTheDocument();
  });
});
