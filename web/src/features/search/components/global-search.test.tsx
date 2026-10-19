import type { SearchKind, SearchResults } from '@coretask/types';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent, waitFor } from '@/test/test-utils';
import { useUiStore } from '@/stores/ui.store';

import { useRecentItems } from '../lib/recent-items';
import { GlobalSearch } from './global-search';

const searchCalls: { term: string; kinds: readonly SearchKind[] }[] = [];
let results: SearchResults | undefined;

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', name: 'Acme' }, isLoading: false }),
}));

vi.mock('../hooks/use-search', () => ({
  useSearch: (_workspaceId: string | undefined, term: string, kinds: readonly SearchKind[]) => {
    searchCalls.push({ term, kinds });
    return { data: term.trim() ? results : undefined, isFetching: false, isError: false };
  },
}));

const user = { id: 'u-1', name: 'Ada Lovelace', email: 'ada@acme.test', avatarUrl: null };

const fixture: SearchResults = {
  query: 'launch',
  tasks: [
    {
      id: 't-1',
      title: 'Launch checklist',
      isCompleted: false,
      dueDate: null,
      assignee: null,
      project: { id: 'p-1', name: 'Launch Plan', color: '#6366F1' },
      parent: null,
    },
  ],
  tickets: [],
  projects: [{ id: 'p-1', name: 'Launch Plan', key: 'LAUNCH', color: '#6366F1', status: 'ACTIVE' }],
  people: [{ ...user, role: 'MEMBER' }],
};

const render = () => renderWithRouter(GlobalSearch);
const open = () => act(() => useUiStore.getState().setCommandPaletteOpen(true));

describe('GlobalSearch', () => {
  beforeEach(() => {
    searchCalls.length = 0;
    results = fixture;
    useUiStore.getState().setCommandPaletteOpen(false);
    useRecentItems.setState({ byWorkspace: {} });
  });

  it('offers the places to jump to before anything is typed', async () => {
    await render();
    open();
    expect(await screen.findByText('My tasks')).toBeInTheDocument();
    expect(screen.getByText('Ticket queue')).toBeInTheDocument();
  });

  it('shows each kind of result under its own heading', async () => {
    await render();
    open();
    await userEvent.type(await screen.findByLabelText('Search the workspace'), 'launch');

    expect(await screen.findByText('Launch checklist')).toBeInTheDocument();
    // The chips are named Tasks/Projects/People too, so read the group headings.
    const headings = [...document.querySelectorAll('[cmdk-group-heading]')].map(
      (heading) => heading.textContent,
    );
    expect(headings).toEqual(['Tasks', 'Projects', 'People']);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('narrows the search to one kind when its chip is pressed', async () => {
    await render();
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'People' }));
    await userEvent.type(screen.getByLabelText('Search the workspace'), 'ada');

    await waitFor(() =>
      expect(
        searchCalls.some((call) => call.term === 'ada' && call.kinds.join() === 'people'),
      ).toBe(true),
    );
  });

  it('remembers what was opened, for the empty box next time', async () => {
    await render();
    open();
    await userEvent.type(await screen.findByLabelText('Search the workspace'), 'launch');
    await userEvent.click(await screen.findByText('Launch checklist'));

    await waitFor(() =>
      expect(useRecentItems.getState().byWorkspace['ws-1']?.[0]).toMatchObject({
        kind: 'task',
        id: 't-1',
        href: '/projects/p-1/list?task=t-1',
      }),
    );
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });
});
