import type { TeamDetail } from '@coretask/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TeamDetailPage } from './team-detail-page';

const navigate = vi.fn();
const post = vi.fn();
let me = { id: 'u-2' };
let role = 'MEMBER';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock('@/stores/auth.store', () => ({ useCurrentUser: () => me }));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({ workspace: { id: 'ws-1', role } }),
}));

const team: TeamDetail = {
  id: 't-1',
  workspaceId: 'ws-1',
  name: 'Maintenance crew',
  description: 'Keeps the buildings standing.',
  color: '#0ea5e9',
  lead: { id: 'u-1', name: 'Ada Owner', email: 'a@x.org', avatarUrl: null },
  leadId: 'u-1',
  memberCount: 2,
  projectCount: 1,
  members: [
    { id: 'u-1', name: 'Ada Owner', email: 'a@x.org', avatarUrl: null },
    { id: 'u-2', name: 'Bea Member', email: 'b@x.org', avatarUrl: null },
  ],
  projects: [{ id: 'p-1', name: 'Repairs', key: 'REP', color: '#f00', isArchived: false }],
  createdAt: '',
  updatedAt: '',
};

vi.mock('../hooks/use-teams', () => ({
  useTeam: () => ({ data: team, isLoading: false, isError: false }),
}));

vi.mock('../hooks/use-team-messages', () => ({
  useTeamMessages: () => ({ data: [], isLoading: false }),
  usePostTeamMessage: () => ({ mutate: post, isPending: false }),
  useReplyToTeamMessage: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteTeamMessage: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../components/team-form-dialog', () => ({ TeamFormDialog: () => null }));
vi.mock('../components/team-roster-dialog', () => ({ TeamRosterDialog: () => null }));

const renderPage = (tab: 'overview' | 'messages' = 'overview') =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TeamDetailPage teamId="t-1" tab={tab} />
    </QueryClientProvider>,
  );

beforeEach(() => {
  navigate.mockReset();
  me = { id: 'u-2' };
  role = 'MEMBER';
});

describe('TeamDetailPage', () => {
  it('shows the team, its projects and its people, with the lead marked', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole('heading', { name: 'Maintenance crew' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Team projects' })).getByText('Repairs'),
    ).toBeInTheDocument();
    const members = screen.getByRole('list', { name: 'Team members' });
    expect(within(members).getAllByRole('listitem')[0]).toHaveTextContent('Lead');
    // Not the lead, not an admin: no editing.
    expect(screen.queryByRole('button', { name: 'Edit team' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Messages' }));
    expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ search: { tab: 'messages' } }));
  });

  it('lets someone on the team start a conversation, and only them', async () => {
    renderPage('messages');
    expect(screen.getByRole('button', { name: 'New message' })).toBeInTheDocument();
  });

  it('keeps someone off the team to reading', () => {
    me = { id: 'u-9' };
    renderPage('messages');
    expect(screen.queryByRole('button', { name: 'New message' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing posted yet.')).toBeInTheDocument();
  });
});
