import { WorkspaceRole } from '@coretask/contracts';
import type { PortfolioMessage } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { PortfolioMessagesPage } from './portfolio-messages-page';

let role: WorkspaceRole = WorkspaceRole.MEMBER;
const reply = vi.fn();
const remove = vi.fn();

vi.mock('@/features/workspaces/hooks/use-workspaces', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', role } }),
}));

vi.mock('@/stores/auth.store', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCurrentUser: () => ({ id: 'me', name: 'Me' }),
}));

vi.mock('../hooks/use-portfolios', () => ({
  usePortfolio: () => ({ portfolio: { id: 'pf-1', name: 'Programme' }, isLoading: false }),
}));

const message = (over: Partial<PortfolioMessage>): PortfolioMessage => ({
  id: 'm',
  portfolioId: 'pf-1',
  title: 'Message',
  body: '<p>Body</p>',
  author: { id: 'someone', name: 'Someone', avatarUrl: null },
  replies: [],
  createdAt: '2026-10-01T00:00:00Z',
  ...over,
});

vi.mock('../hooks/use-portfolio-messages', () => ({
  usePortfolioMessages: () => ({
    isLoading: false,
    data: [
      message({
        id: 'mine',
        title: 'Q4 priorities',
        author: { id: 'me', name: 'Me', avatarUrl: null },
      }),
      message({ id: 'theirs', title: 'Budget' }),
    ],
  }),
  usePostPortfolioMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useReplyToPortfolioMessage: () => ({ mutate: reply, isPending: false }),
  useDeletePortfolioMessage: () => ({ mutate: remove, isPending: false }),
}));

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PortfolioMessagesPage portfolioId="pf-1" />
    </QueryClientProvider>,
  );

beforeEach(() => {
  role = WorkspaceRole.MEMBER;
  reply.mockReset();
  remove.mockReset();
});

describe('PortfolioMessagesPage', () => {
  it('lets a member reply, and delete only their own message', async () => {
    const user = setupUser();
    renderPage();

    expect(screen.getByText(/span the projects in Programme/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New message' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'More actions for Q4 priorities' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'More actions for Budget' }),
    ).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Reply to Budget' }), 'Agreed');
    await user.click(screen.getAllByRole('button', { name: 'Reply' })[1] as HTMLElement);
    expect(reply).toHaveBeenCalledWith({ messageId: 'theirs', body: 'Agreed' }, expect.anything());
  });

  it('gives a guest the conversation to read and nothing to press', () => {
    role = WorkspaceRole.GUEST;
    renderPage();

    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New message' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Reply to/ })).not.toBeInTheDocument();
  });
});
