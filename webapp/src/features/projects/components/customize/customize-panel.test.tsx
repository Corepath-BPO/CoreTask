import { CustomFieldType, WorkspaceRole } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutomationRule } from '@/features/automations/api/automations.api';
import { renderWithRouter, screen, setupUser } from '@/test/test-utils';

import { CustomizePanel } from './customize-panel';

/*
 * The two data sources behind the counts, swapped per test. Everything else in
 * the hooks module stays real — the section views lean on mutations that only
 * fire on interaction the tests never perform.
 */
const fieldMetadata = vi.fn();
const automations = vi.fn();
const forms = vi.fn();
const templates = vi.fn();
const statusTemplates = vi.fn();
const bundles = vi.fn();

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

vi.mock('@/features/projects/hooks/use-forms', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProjectForms: (...args: unknown[]) => forms(...args),
}));

vi.mock('@/features/projects/hooks/use-project-email', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProjectEmail: () => ({ data: undefined, isLoading: false }),
}));

vi.mock('@/features/projects/hooks/use-project-apps', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useProjectApps: () => ({ data: [], isLoading: false }),
}));
vi.mock('@/features/projects/hooks/use-bundles', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useBundles: (...args: unknown[]) => bundles(...args),
}));

vi.mock('@/features/projects/hooks/use-status-templates', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useStatusTemplates: (...args: unknown[]) => statusTemplates(...args),
}));

vi.mock('@/features/projects/hooks/use-task-templates', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useTaskTemplates: (...args: unknown[]) => templates(...args),
}));

const field = (index: number, isArchived = false) =>
  ({
    id: `field-${index}`,
    projectId: 'p-1',
    name: `Field ${index}`,
    description: null,
    type: CustomFieldType.TEXT,
    isRequired: false,
    notifyOnChange: false,
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
  forms.mockReturnValue({ data: [{ id: 'form-1' }, { id: 'form-2' }], isLoading: false });
  templates.mockReturnValue({ data: [{ id: 'template-1' }], isLoading: false });
  bundles.mockReturnValue({
    data: [
      { id: 'b-1', projects: [{ id: 'p-1', name: 'Here', appliedVersion: 1 }] },
      { id: 'b-2', projects: [{ id: 'p-9', name: 'Elsewhere', appliedVersion: 1 }] },
    ],
    isLoading: false,
  });
  statusTemplates.mockReturnValue({
    data: [{ id: 'st-1' }, { id: 'st-2' }, { id: 'st-3' }],
    isLoading: false,
  });
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
    expect(screen.getByRole('button', { name: /^Forms/ })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: /Task types and templates/ })).toHaveTextContent('1');
  });

  it('does not ask a guest’s browser for the forms, which only editors manage', async () => {
    await renderPanel({ role: WorkspaceRole.GUEST }).result;

    expect(forms).toHaveBeenCalledWith(undefined, 'p-1');
  });

  it('shows no count until the data has arrived', async () => {
    fieldMetadata.mockReturnValue({ data: undefined, isLoading: true });
    automations.mockReturnValue({ data: undefined, isLoading: true });

    await renderPanel().result;

    expect(screen.getByRole('button', { name: /Rules/ })).not.toHaveTextContent(/\d/);
    expect(screen.getByRole('button', { name: /^Fields/ })).not.toHaveTextContent(/\d/);
  });

  it('has every feature built: nothing says Soon, and every row opens', async () => {
    await renderPanel().result;

    expect(screen.queryByText('Soon')).not.toBeInTheDocument();
    // Apps counts its connections like the other rows count theirs.
    expect(screen.getByRole('button', { name: /^Apps/ })).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: /^Apps/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Emails/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Bundles/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Status templates/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^Forms/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Task types and templates/ })).toBeEnabled();
  });

  it('closes from the header button and from Escape', async () => {
    const user = setupUser();
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
    const user = setupUser();
    await renderPanel().result;

    await user.click(screen.getByRole('button', { name: /^Fields/ }));

    expect(screen.getByRole('heading', { name: 'Fields' })).toBeInTheDocument();
    expect(screen.getByText('Field 0')).toBeInTheDocument();
    // The archived eighth field stays out of the list, as out of the count.
    expect(screen.queryByText('Field 7')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to customize' }));
    expect(screen.getByRole('heading', { name: 'Customize' })).toBeInTheDocument();
  });

  it('opens a feature from the Add menu', async () => {
    const user = setupUser();
    await renderPanel().result;

    await user.click(screen.getByRole('button', { name: 'Add' }));
    await user.click(screen.getByRole('menuitem', { name: 'Fields' }));

    expect(screen.getByRole('heading', { name: 'Fields' })).toBeInTheDocument();
  });

  it('opens the Rules section listing every rule', async () => {
    const user = setupUser();
    await renderPanel().result;

    await user.click(screen.getByRole('button', { name: /Rules/ }));

    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument();
    expect(screen.getByText('Rule 0')).toBeInTheDocument();
    expect(screen.getByText('Rule 10')).toBeInTheDocument();
  });
});
