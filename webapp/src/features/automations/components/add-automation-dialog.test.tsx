import type { AutomationTemplate } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, setupUser, within } from '@/test/test-utils';

import { AddAutomationDialog } from './add-automation-dialog';

const navigate = vi.fn();
const back = vi.fn();
let canGoBack = true;
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ history: { back } }),
  useCanGoBack: () => canGoBack,
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1' } }),
}));

vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProject: () => ({ data: { id: 'p-1' } }),
}));

let canManage = true;
vi.mock('@/features/projects/lib/project-access', () => ({
  useProjectAccess: () => ({ canManage }),
}));

const apply = vi.fn();
const templatesHook = vi.fn();
vi.mock('@/features/automations/hooks/use-automation-templates', () => ({
  useAutomationTemplates: (...args: unknown[]) => templatesHook(...args),
  useApplyTemplate: () => ({ mutate: apply, isPending: false }),
}));

const template = {
  id: 't-1',
  workspaceId: 'ws-1',
  name: 'Escalate overdue work',
  description: 'Flag overdue tasks and tell the owner.',
  triggerType: 'TASK_OVERDUE',
  triggerConfig: {},
  nodes: [
    {
      id: 'a',
      nodeType: 'ACTION',
      subtype: 'UPDATE_PRIORITY',
      configuration: {},
      position: { x: 0, y: 0 },
      parentId: null,
      branchKey: null,
      order: 0,
    },
  ],
  allowChaining: false,
  sourceRuleId: null,
  sourceProject: { id: 'p-9', name: 'IT Development' },
  createdBy: null,
  useCount: 0,
  lastUsedAt: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as unknown as AutomationTemplate;

beforeEach(() => {
  navigate.mockReset();
  back.mockReset();
  apply.mockReset();
  canGoBack = true;
  canManage = true;
  templatesHook.mockReturnValue({
    data: [template],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

const prompt = () => screen.getByRole('textbox', { name: 'What do you want to automate?' });
const featured = () => screen.getByRole('region', { name: 'Featured' });
const saved = () => screen.getByRole('region', { name: 'Saved in this workspace' });

describe('AddAutomationDialog', () => {
  it('asks what to automate, and starts a blank rule from scratch', async () => {
    const user = setupUser();
    renderWithProviders(<AddAutomationDialog projectId="p-1" />);

    expect(screen.getByRole('dialog', { name: 'Add automation' })).toBeInTheDocument();
    expect(prompt()).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Start from scratch' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId/automations/new',
      params: { projectId: 'p-1' },
      search: {},
    });
  });

  it('opens a starter in the builder, unsaved', async () => {
    const user = setupUser();
    renderWithProviders(<AddAutomationDialog projectId="p-1" />);

    expect(within(featured()).getAllByRole('button')).toHaveLength(6);
    await user.click(
      within(featured()).getByRole('button', { name: /^Assign whoever owns a section/ }),
    );
    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId/automations/new',
      params: { projectId: 'p-1' },
      search: { starter: 'assign-on-arrival' },
    });
  });

  it('starts a draft here from a rule saved in the workspace', async () => {
    const user = setupUser();
    renderWithProviders(<AddAutomationDialog projectId="p-1" />);

    const card = within(saved()).getByRole('button', { name: /^Escalate overdue work/ });
    expect(card).toHaveTextContent('From IT Development');

    await user.click(card);
    expect(apply).toHaveBeenCalledWith({ templateId: 't-1' }, expect.any(Object));
  });

  it('ranks the gallery by what is typed, and says when nothing does it', async () => {
    const user = setupUser();
    renderWithProviders(<AddAutomationDialog projectId="p-1" />);

    await user.type(prompt(), 'assign tasks when they move to a section');
    const cards = within(featured()).getAllByRole('button');
    expect(cards[0]).toHaveAccessibleName(/^Assign whoever owns a section/);
    expect(cards.length).toBeLessThan(6);
    // The saved rule is about overdue work, so it steps aside.
    expect(screen.queryByRole('region', { name: 'Saved in this workspace' })).toBeNull();

    await user.clear(prompt());
    await user.type(prompt(), 'post to a webhook');
    expect(screen.getByText(/Nothing here does that yet/)).toBeInTheDocument();
  });

  it('says how to fill the library while nothing is saved', () => {
    templatesHook.mockReturnValue({ data: [], isLoading: false, isError: false, refetch: vi.fn() });
    renderWithProviders(<AddAutomationDialog projectId="p-1" />);

    expect(saved()).toHaveTextContent(/Nothing saved yet/);
  });

  it('closes back to wherever it was opened from', async () => {
    const user = setupUser();
    const { unmount } = renderWithProviders(<AddAutomationDialog projectId="p-1" />);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(back).toHaveBeenCalled();
    unmount();

    // Opened from a link, with nothing to go back to: the Automations tab.
    canGoBack = false;
    renderWithProviders(<AddAutomationDialog projectId="p-1" />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(navigate).toHaveBeenCalledWith({
      to: '/projects/$projectId/automations',
      params: { projectId: 'p-1' },
      search: {},
    });
  });

  it('offers nothing to add to somebody who cannot manage the project', () => {
    canManage = false;
    renderWithProviders(<AddAutomationDialog projectId="p-1" />);

    expect(screen.getByText(/Only the people who manage this project/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    // Nor asks for the library it would not show.
    expect(templatesHook).toHaveBeenCalledWith('ws-1', false);
  });
});
