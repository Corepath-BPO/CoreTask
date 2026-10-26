import type { SavedSearch, TaskSearchPage } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import type { SearchParams } from '../lib/search-url';

import { AdvancedSearchPage } from './advanced-search-page';

const BEA = '01a1224e-60f8-78f3-a8ac-ec92e54bb663';
const navigate = vi.fn();
const save = vi.fn();
const update = vi.fn();
const remove = vi.fn();
const searched = vi.fn();
let page: TaskSearchPage;
let saved: SavedSearch[];

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

vi.mock('../hooks/use-advanced-search', () => ({
  useTaskSearch: (_workspaceId: string, filters: unknown) => {
    searched(filters);
    return { data: page, isLoading: false, isFetching: false };
  },
  useSavedSearches: () => ({ data: saved }),
  useSaveSearch: () => ({ mutate: save, isPending: false }),
  useUpdateSavedSearch: () => ({ mutate: update, isPending: false }),
  useDeleteSavedSearch: () => ({ mutate: remove, isPending: false }),
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', role: 'MEMBER' } }),
  useWorkspaceMembers: () => ({
    data: [{ user: { id: BEA, name: 'Bea Member', email: 'b@x.org', avatarUrl: null } }],
  }),
}));

vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ data: { items: [{ id: 'p-1', name: 'Maintenance' }] } }),
}));

vi.mock('@/features/tags/hooks/use-tags', () => ({
  useTags: () => ({ data: [] }),
}));

vi.mock('@/features/tasks/components/task-detail-dialog', () => ({
  TaskDetailDialog: ({ taskId }: { taskId: string | null }) =>
    taskId ? <div role="dialog" aria-label="Task panel" /> : null,
}));

const renderPage = (params: SearchParams = {}) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AdvancedSearchPage params={params} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  for (const mock of [navigate, save, update, remove, searched]) mock.mockReset();
  saved = [];
  page = {
    total: 2,
    items: [
      {
        id: 't-1',
        title: 'Leak under the sink',
        completedAt: null,
        dueDate: '2020-01-01T00:00:00.000Z',
        project: { id: 'p-1', name: 'Maintenance', color: '#f00' },
        parentTitle: null,
        assignee: { id: 'u-2', name: 'Bea Member', email: 'b@x.org', avatarUrl: null },
        updatedAt: '2026-10-14T00:00:00Z',
      },
      {
        id: 't-2',
        title: 'Check the valve',
        completedAt: '2026-10-13T00:00:00Z',
        dueDate: null,
        project: null,
        parentTitle: 'Annual service',
        assignee: null,
        updatedAt: '2026-10-14T00:00:00Z',
      },
    ],
  };
});

describe('AdvancedSearchPage', () => {
  it('searches what the address says, and lists what it found', async () => {
    const user = setupUser();
    renderPage({ q: 'leak', assignee: 'me', due: 'OVERDUE' });

    expect(searched).toHaveBeenLastCalledWith({
      text: 'leak',
      assigneeIds: ['me'],
      due: 'OVERDUE',
    });
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
    const results = screen.getByRole('region', { name: 'Results' });
    expect(within(results).getByText('Subtask of Annual service')).toBeInTheDocument();
    expect(within(results).getByLabelText('Completed')).toBeInTheDocument();
    expect(within(results).getByText('Maintenance')).toBeInTheDocument();

    await user.click(within(results).getByText('Leak under the sink'));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        to: '/search',
        search: { q: 'leak', assignee: 'me', due: 'OVERDUE', task: 't-1' },
      }),
    );
  });

  it('changes the search from its filters and its words', async () => {
    const user = setupUser();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'Filter by assignee' }));
    await user.click(await screen.findByRole('option', { name: /Bea Member/ }));
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: { assignee: BEA } }),
    );

    await user.type(screen.getByLabelText('Contains the words'), 'boiler');
    await waitFor(() =>
      expect(navigate).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: { q: 'boiler' } }),
      ),
    );
  });

  it('saves a search under a name, and opens it once saved', async () => {
    const user = setupUser();
    save.mockImplementation((_payload, options: { onSuccess: (s: SavedSearch) => void }) =>
      options.onSuccess({
        id: 's-1',
        name: 'Overdue',
        filters: { due: 'OVERDUE' },
        createdAt: '',
        updatedAt: '',
      }),
    );
    renderPage({ due: 'OVERDUE' });

    await user.click(screen.getByRole('button', { name: 'Save search' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Search name'), 'Overdue');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(
      { name: 'Overdue', filters: { due: 'OVERDUE' } },
      expect.anything(),
    );
    expect(navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: { due: 'OVERDUE', saved: 's-1' } }),
    );
  });

  it('offers to save changes to a saved search that no longer matches', async () => {
    const user = setupUser();
    saved = [
      { id: 's-1', name: 'Mine', filters: { assigneeIds: ['me'] }, createdAt: '', updatedAt: '' },
    ];
    const { unmount } = renderPage({ assignee: 'me', saved: 's-1' });
    expect(screen.getByRole('heading', { name: 'Mine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    unmount();

    renderPage({ assignee: 'me', due: 'TODAY', saved: 's-1' });
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(update).toHaveBeenCalledWith({
      searchId: 's-1',
      payload: { filters: { assigneeIds: ['me'], due: 'TODAY' } },
    });
  });

  it('opens the task named in the address over the results', () => {
    renderPage({ task: 't-1' });
    expect(screen.getByRole('dialog', { name: 'Task panel' })).toBeInTheDocument();
  });
});
