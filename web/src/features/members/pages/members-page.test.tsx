import { WorkspaceRole } from '@coretask/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth.store';

import { MembersPage } from './members-page';

const WORKSPACE = '019fc880-0000-7000-8000-000000000000';
const ME = '019fc880-0000-7000-8000-00000000aaaa';

const listInvitations = vi.fn();
const createInvitation = vi.fn();
const revokeInvitation = vi.fn();

let activeRole: WorkspaceRole = WorkspaceRole.OWNER;

vi.mock('../api/invitations.api', () => ({
  invitationsApi: {
    list: (...args: unknown[]) => listInvitations(...args),
    create: (...args: unknown[]) => createInvitation(...args),
    revoke: (...args: unknown[]) => revokeInvitation(...args),
    preview: vi.fn(),
    accept: vi.fn(),
  },
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({
    workspace: { id: WORKSPACE, name: 'Acme Product', role: activeRole },
    workspaces: [],
    isLoading: false,
    select: vi.fn(),
  }),
  useWorkspaceMembers: () => ({
    data: [
      {
        id: 'm1',
        workspaceId: WORKSPACE,
        role: WorkspaceRole.OWNER,
        joinedAt: '2026-01-01T00:00:00.000Z',
        user: { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
      },
      {
        id: 'm2',
        workspaceId: WORKSPACE,
        role: WorkspaceRole.MEMBER,
        joinedAt: '2026-02-01T00:00:00.000Z',
        user: { id: 'u2', name: 'Jonas Feld', email: 'jonas@coretask.dev', avatarUrl: null },
      },
    ],
    isLoading: false,
  }),
}));

function invitation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inv-1',
    workspaceId: WORKSPACE,
    email: 'ada@example.com',
    role: WorkspaceRole.MEMBER,
    invitedBy: { id: ME, name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null },
    expiresAt: '2099-01-01T00:00:00.000Z',
    expired: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  return render(
    <QueryClientProvider client={client}>
      <MembersPage />
    </QueryClientProvider>,
  );
}

describe('MembersPage', () => {
  beforeEach(() => {
    listInvitations.mockReset();
    createInvitation.mockReset();
    revokeInvitation.mockReset();
    activeRole = WorkspaceRole.OWNER;

    listInvitations.mockResolvedValue([]);
    useAuthStore.setState({
      status: 'authenticated',
      user: {
        id: ME,
        email: 'demo@coretask.dev',
        name: 'Demo Owner',
        avatarUrl: null,
        timezone: 'UTC',
        emailVerified: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
  });

  it('lists members with their roles and marks you', async () => {
    renderPage();

    expect(await screen.findByText('Jonas Feld')).toBeInTheDocument();
    expect(screen.getByText('Demo Owner')).toBeInTheDocument();
    expect(screen.getByText('(you)')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
  });

  it('shows pending invitations to an administrator', async () => {
    listInvitations.mockResolvedValue([invitation()]);
    renderPage();

    expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
  });

  it('says so when nobody is waiting', async () => {
    renderPage();
    expect(await screen.findByText(/nobody is waiting/i)).toBeInTheDocument();
  });

  /**
   * Listing invitations is admin-only server-side, so asking as a member would
   * be a guaranteed 403. The page must not make the request at all.
   */
  it('hides invitations from a member and never asks for them', async () => {
    activeRole = WorkspaceRole.MEMBER;
    renderPage();

    expect(await screen.findByText('Jonas Feld')).toBeInTheDocument();
    expect(screen.queryByText(/pending invitations/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument();
    expect(listInvitations).not.toHaveBeenCalled();
  });

  it('sends an invitation and closes the dialog', async () => {
    const user = userEvent.setup();
    createInvitation.mockResolvedValue(invitation());
    renderPage();

    await user.click(await screen.findByRole('button', { name: /invite/i }));
    await user.type(screen.getByLabelText(/e-mail/i), 'ada@example.com');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));

    await waitFor(() => expect(createInvitation).toHaveBeenCalledTimes(1));
    expect(createInvitation.mock.calls[0]?.[1]).toEqual({
      email: 'ada@example.com',
      role: WorkspaceRole.MEMBER,
    });
  });

  it('rejects a malformed address before sending anything', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /invite/i }));
    await user.type(screen.getByLabelText(/e-mail/i), 'not-an-address');
    await user.click(screen.getByRole('button', { name: /send invitation/i }));

    expect(await screen.findByText(/valid e-mail/i)).toBeInTheDocument();
    expect(createInvitation).not.toHaveBeenCalled();
  });

  /** The picker must not offer what the API would refuse. */
  it('never offers Owner in the role picker', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /invite/i }));
    await user.click(screen.getByLabelText(/role/i));

    expect(await screen.findByRole('option', { name: 'Admin' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument();
  });

  it('revokes an invitation', async () => {
    const user = userEvent.setup();
    listInvitations.mockResolvedValue([invitation()]);
    revokeInvitation.mockResolvedValue(undefined);
    renderPage();

    await user.click(await screen.findByRole('button', { name: /revoke the invitation/i }));

    await waitFor(() => expect(revokeInvitation).toHaveBeenCalledWith(WORKSPACE, 'inv-1'));
  });

  it('marks an expired invitation rather than hiding it', async () => {
    listInvitations.mockResolvedValue([
      invitation({ expired: true, expiresAt: '2020-01-01T00:00:00.000Z' }),
    ]);
    renderPage();

    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });
});
