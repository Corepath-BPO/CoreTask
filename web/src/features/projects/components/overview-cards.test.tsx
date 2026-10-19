import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyResourcesCard, MilestonesCard, ProjectPortfoliosCard } from './overview-cards';

const add = vi.fn();
const remove = vi.fn();
const listed = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#portfolio">{children}</a>,
}));
vi.mock('../hooks/use-project-resources', () => ({
  useProjectResources: () => ({
    data: [{ id: 'r-1', title: 'Brief', url: 'https://docs.example.org/brief' }],
  }),
  useAddProjectResource: () => ({ mutate: add, isPending: false }),
  useRemoveProjectResource: () => ({ mutate: remove, isPending: false }),
}));
vi.mock('@/features/tasks/hooks/use-tasks', () => ({
  useTasks: (_workspaceId: string, params: unknown) => {
    listed(params);
    return {
      data: {
        items: [
          { id: 'm-2', title: 'Launch', dueDate: '2026-11-08T00:00:00Z', completedAt: null },
          { id: 'm-3', title: 'Someday', dueDate: null, completedAt: null },
          {
            id: 'm-1',
            title: 'Beta',
            dueDate: '2026-10-20T00:00:00Z',
            completedAt: '2026-10-19T00:00:00Z',
          },
        ],
      },
    };
  },
}));
vi.mock('@/features/portfolios/hooks/use-portfolios', () => ({
  usePortfolios: () => [
    { id: 'pf-1', name: 'Q4 launches', color: '#f00', projectIds: ['p-1', 'p-2'] },
    { id: 'pf-2', name: 'Elsewhere', color: '#0f0', projectIds: ['p-9'] },
  ],
}));

const wrap = (node: ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>);

beforeEach(() => {
  add.mockReset();
  remove.mockReset();
});

describe('Overview cards', () => {
  it('lists key resources as links, and lets an editor add and remove them', async () => {
    const user = userEvent.setup();
    wrap(<KeyResourcesCard workspaceId="ws-1" projectId="p-1" canEdit />);

    expect(screen.getByRole('link', { name: 'Brief' })).toHaveAttribute(
      'href',
      'https://docs.example.org/brief',
    );
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    await user.type(screen.getByLabelText('Link'), 'drive.example.org/folder');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(add).toHaveBeenCalledWith(
      { title: '', url: 'drive.example.org/folder' },
      expect.anything(),
    );
    await user.click(screen.getByRole('button', { name: 'Remove Brief' }));
    expect(remove).toHaveBeenCalledWith('r-1');
  });

  it('shows milestones soonest first, undated last, and opens one', async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    wrap(<MilestonesCard workspaceId="ws-1" projectId="p-1" onOpenTask={onOpenTask} />);

    expect(listed).toHaveBeenCalledWith(expect.objectContaining({ kind: 'MILESTONE' }));
    const items = within(screen.getByRole('list', { name: 'Milestones' })).getAllByRole('button');
    expect(items[0]).toHaveTextContent('Beta');
    expect(items[1]).toHaveTextContent('Launch');
    expect(items[2]).toHaveTextContent('SomedayNo date');
    await user.click(items[1] as HTMLElement);
    expect(onOpenTask).toHaveBeenCalledWith('m-2');
  });

  it('names only the portfolios the project is in', () => {
    wrap(<ProjectPortfoliosCard workspaceId="ws-1" projectId="p-1" />);
    expect(screen.getByText('Q4 launches')).toBeInTheDocument();
    expect(screen.queryByText('Elsewhere')).not.toBeInTheDocument();
  });
});
