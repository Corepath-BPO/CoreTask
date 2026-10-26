import type { Goal, GoalUpdate } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { GoalUpdatesSection } from './goal-updates-section';

const post = vi.fn();
const remove = vi.fn();
let updates: GoalUpdate[];

vi.mock('../hooks/use-goal-updates', () => ({
  useGoalUpdates: () => ({ data: updates }),
  usePostGoalUpdate: () => ({ mutate: post, isPending: false }),
  useDeleteGoalUpdate: () => ({ mutate: remove, isPending: false }),
}));

const goal = { id: 'g-1', status: 'AT_RISK', progress: 40 } as Goal;

const renderSection = (canPost = true) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GoalUpdatesSection
        workspaceId="ws-1"
        goal={goal}
        canPost={canPost}
        canManage={false}
        currentUserId="u-1"
      />
    </QueryClientProvider>,
  );

beforeEach(() => {
  post.mockReset();
  remove.mockReset();
  updates = [
    {
      id: 'up-2',
      goalId: 'g-1',
      status: 'AT_RISK',
      progress: 40,
      body: '<p>Two units empty.</p>',
      author: { id: 'u-1', name: 'Ada Owner', avatarUrl: null },
      createdAt: new Date().toISOString(),
    },
    {
      id: 'up-1',
      goalId: 'g-1',
      status: 'ON_TRACK',
      progress: 20,
      body: '',
      author: { id: 'u-2', name: 'Bea Member', avatarUrl: null },
      createdAt: new Date().toISOString(),
    },
  ];
});

describe('GoalUpdatesSection', () => {
  it('posts an update from the goal’s current status and a note', async () => {
    const user = setupUser();
    renderSection();

    await user.type(screen.getByLabelText('What changed'), 'Leases signed for 4B.');
    await user.click(screen.getByRole('button', { name: 'Post update' }));
    expect(post).toHaveBeenCalledWith(
      { status: 'AT_RISK', body: 'Leases signed for 4B.' },
      expect.anything(),
    );
  });

  it('lists the history, letting authors delete their own', () => {
    renderSection();
    const list = screen.getByRole('list', { name: 'Goal updates' });
    const [mine, theirs] = within(list).getAllByRole('listitem');
    expect(mine).toHaveTextContent('Two units empty.');
    expect(mine).toHaveTextContent('40%');
    expect(
      within(mine as HTMLElement).getByRole('button', { name: 'Delete this update' }),
    ).toBeInTheDocument();
    expect(
      within(theirs as HTMLElement).queryByRole('button', { name: 'Delete this update' }),
    ).not.toBeInTheDocument();
  });

  it('only reads for someone who cannot post', () => {
    renderSection(false);
    expect(screen.queryByRole('button', { name: 'Post update' })).not.toBeInTheDocument();
  });
});
