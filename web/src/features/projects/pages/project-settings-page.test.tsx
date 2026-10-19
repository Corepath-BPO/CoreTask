import type { PriorityDefinition, StatusDefinition } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectSettingsPage } from './project-settings-page';

const saveStatus = vi.fn();
const reorderStatuses = vi.fn();
const deleteStatus = vi.fn();
const savePriority = vi.fn();
let role = 'MANAGER';

const status = (
  id: string,
  name: string,
  over: Partial<StatusDefinition> = {},
): StatusDefinition => ({
  id,
  projectId: null,
  name,
  category: 'NOT_STARTED',
  colorToken: 'gray',
  position: 0,
  isDefault: false,
  isArchived: false,
  ...over,
});

const priority = (id: string, name: string, level: number): PriorityDefinition => ({
  id,
  name,
  level,
  colorToken: 'red',
  position: 0,
  isDefault: false,
  isArchived: false,
});

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', role } }),
}));

vi.mock('../hooks/use-projects', () => ({
  useProject: () => ({
    data: {
      id: 'p-1',
      name: 'Maintenance',
      key: 'MNT',
      color: '#f00',
      visibility: 'PUBLIC',
      startDate: null,
      dueDate: null,
      description: null,
      archivedAt: null,
      access: null,
    },
  }),
  useArchiveProject: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../lib/project-access', () => ({
  useProjectAccess: () => ({ canManage: role === 'MANAGER' }),
}));

vi.mock('../components/project-form-dialog', () => ({ ProjectFormDialog: () => null }));

vi.mock('../hooks/use-definitions', () => ({
  useProjectStatuses: () => ({
    data: [
      status('s-1', 'To do', { isDefault: true }),
      status('s-2', 'Doing', { category: 'ACTIVE' }),
      status('s-3', 'Done', { category: 'COMPLETED' }),
    ],
    isLoading: false,
  }),
  useSaveStatus: () => ({ mutate: saveStatus, isPending: false }),
  useDeleteStatus: () => ({ mutate: deleteStatus, isPending: false }),
  useReorderStatuses: () => ({ mutate: reorderStatuses, isPending: false }),
  usePriorities: () => ({
    data: [priority('r-1', 'High', 3), priority('r-2', 'Low', 1)],
    isLoading: false,
  }),
  useSavePriority: () => ({ mutate: savePriority, isPending: false }),
  useDeletePriority: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderPriorities: () => ({ mutate: vi.fn(), isPending: false }),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ProjectSettingsPage projectId="p-1" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  for (const mock of [saveStatus, reorderStatuses, deleteStatus, savePriority]) mock.mockReset();
  role = 'MANAGER';
});

describe('ProjectSettingsPage', () => {
  it('renames, reorders and adds statuses', async () => {
    const user = userEvent.setup();
    renderPage();
    const statuses = screen.getByRole('list', { name: 'Task statuses' });
    expect(screen.getByText(/uses the workspace’s statuses/)).toBeInTheDocument();

    await user.click(within(statuses).getByRole('button', { name: 'Rename Doing' }));
    const input = within(statuses).getByRole('textbox', { name: 'Rename Doing' });
    await user.clear(input);
    await user.type(input, 'In progress{Enter}');
    expect(saveStatus).toHaveBeenCalledWith({ statusId: 's-2', draft: { name: 'In progress' } });

    await user.click(within(statuses).getByRole('button', { name: 'Move Done up' }));
    expect(reorderStatuses).toHaveBeenCalledWith(['s-1', 's-3', 's-2']);
    expect(within(statuses).getByRole('button', { name: 'Move To do up' })).toBeDisabled();
    // The default can be neither archived nor deleted.
    expect(within(statuses).getByRole('button', { name: 'Delete To do' })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: 'New status' }), 'Waiting');
    await user.click(screen.getAllByRole('button', { name: 'Add' })[0] as HTMLElement);
    expect(saveStatus).toHaveBeenLastCalledWith({
      draft: { name: 'Waiting', category: 'NOT_STARTED' },
    });
  });

  it('adds a priority below the most urgent level', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByRole('textbox', { name: 'New priority' }), 'Urgent');
    await user.click(screen.getAllByRole('button', { name: 'Add' })[1] as HTMLElement);
    expect(savePriority).toHaveBeenCalledWith({ draft: { name: 'Urgent', level: 4 } });
  });

  it('only reads for someone who is not a manager', () => {
    role = 'MEMBER';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Archive project/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Only a manager can change them/)).toHaveLength(2);
  });
});
