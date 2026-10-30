import { WorkspaceRole } from '@coretask/contracts';
import type { AdminMember } from '@coretask/types';
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setupUser } from '@/test/test-utils';

import { AdminMembersPage } from './admin-members-page';

const deactivate = vi.fn();
const reactivate = vi.fn();
const remove = vi.fn();
const updateRole = vi.fn();
let actorRole: WorkspaceRole = WorkspaceRole.OWNER;
let members: AdminMember[] = [];

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useActiveWorkspace: () => ({
    workspace: { id: 'ws-1', name: 'Acme', slug: 'acme', role: actorRole },
    isLoading: false,
  }),
}));

vi.mock('@/stores/auth.store', () => ({ useCurrentUser: () => ({ id: 'u-owner' }) }));

vi.mock('@/features/members/components/invite-member-dialog', () => ({
  InviteMemberDialog: () => null,
}));

vi.mock('@/features/members/hooks/use-invitations', () => ({
  useInvitations: () => ({ data: [], isLoading: false }),
  useRevokeInvitation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/features/members/hooks/use-members', () => ({
  useUpdateMemberRole: () => ({ mutate: updateRole, isPending: false }),
  useTransferOwnership: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('../hooks/use-admin', () => ({
  useAdminMembers: () => ({ data: members, isLoading: false }),
  useDeactivateMember: () => ({ mutate: deactivate, isPending: false }),
  useReactivateMember: () => ({ mutate: reactivate, isPending: false }),
  useAdminRemoveMember: () => ({ mutate: remove, isPending: false }),
  useInvitationLink: () => ({ mutate: vi.fn(), isPending: false }),
}));

function person(
  id: string,
  name: string,
  role: WorkspaceRole,
  overrides: Partial<AdminMember> = {},
): AdminMember {
  return {
    id: `m-${id}`,
    role,
    status: 'ACTIVE',
    joinedAt: '2026-10-01T00:00:00Z',
    invitedBy: null,
    deactivatedAt: null,
    deactivatedBy: null,
    user: {
      id: `u-${id}`,
      name,
      email: `${id}@acme.test`,
      avatarUrl: null,
      jobTitle: null,
      lastActiveAt: '2026-10-29T00:00:00Z',
      twoFactorEnabled: false,
      emailVerified: true,
      signInMethods: ['PASSWORD'],
    },
    openTasks: 0,
    openTickets: 0,
    ...overrides,
  };
}

beforeEach(() => {
  for (const mock of [deactivate, reactivate, remove, updateRole]) mock.mockReset();
  actorRole = WorkspaceRole.OWNER;
  members = [
    person('owner', 'Olive Owner', WorkspaceRole.OWNER),
    person('pat', 'Pat Member', WorkspaceRole.MEMBER, { openTasks: 3, openTickets: 1 }),
    person('robin', 'Robin Admin', WorkspaceRole.ADMIN),
    person('gale', 'Gale Guest', WorkspaceRole.GUEST),
    person('asana', 'From Asana', WorkspaceRole.MEMBER, {
      status: 'NOT_SIGNED_UP',
      user: {
        ...person('asana', 'From Asana', WorkspaceRole.MEMBER).user,
        lastActiveAt: null,
        signInMethods: [],
      },
    }),
    person('gone', 'Gone Person', WorkspaceRole.MANAGER, {
      status: 'DEACTIVATED',
      deactivatedAt: '2026-10-28T00:00:00Z',
      deactivatedBy: { id: 'u-owner', name: 'Olive Owner' },
    }),
  ];
});

const rowOf = (name: string) => {
  const cell = screen.getByText(name);
  return cell.closest('tr') as HTMLElement;
};

describe('AdminMembersPage', () => {
  it('shows each person’s status, sign-in and open work', () => {
    render(<AdminMembersPage />);

    expect(within(rowOf('Gone Person')).getByText('Deactivated')).toBeInTheDocument();
    expect(within(rowOf('From Asana')).getByText('Not signed up')).toBeInTheDocument();
    expect(within(rowOf('From Asana')).getByText('Never')).toBeInTheDocument();
    expect(within(rowOf('Pat Member')).getByText('3 tasks, 1 ticket')).toBeInTheDocument();
    expect(screen.getByText('6 of 6 people')).toBeInTheDocument();
  });

  it('deactivates someone and hands their work to the member chosen', async () => {
    const user = setupUser();
    render(<AdminMembersPage />);

    await user.click(screen.getByRole('button', { name: 'Actions for Pat Member' }));
    await user.click(screen.getByRole('menuitem', { name: 'Deactivate…' }));

    const dialog = screen.getByRole('dialog', { name: 'Deactivate Pat Member?' });
    await user.click(within(dialog).getByRole('combobox'));
    // Deactivated people cannot take work over, and nor can the leaver.
    expect(screen.queryByRole('option', { name: 'Reassign to Gone Person' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Reassign to Pat Member' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'Reassign to Robin Admin' }));
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));

    expect(deactivate).toHaveBeenCalledWith(
      { memberId: 'm-pat', payload: { reassignToUserId: 'u-robin' } },
      expect.anything(),
    );
  });

  it('leaves the work unassigned unless someone is chosen', async () => {
    const user = setupUser();
    render(<AdminMembersPage />);

    await user.click(screen.getByRole('button', { name: 'Actions for Pat Member' }));
    await user.click(screen.getByRole('menuitem', { name: 'Remove from workspace…' }));
    await user.click(
      within(screen.getByRole('dialog', { name: 'Remove Pat Member?' })).getByRole('button', {
        name: 'Remove',
      }),
    );

    expect(remove).toHaveBeenCalledWith(
      { memberId: 'm-pat', name: 'Pat Member', payload: { reassignToUserId: null } },
      expect.anything(),
    );
  });

  it('offers reactivation for a deactivated member', async () => {
    const user = setupUser();
    render(<AdminMembersPage />);

    await user.click(screen.getByRole('button', { name: 'Actions for Gone Person' }));
    expect(screen.queryByRole('menuitem', { name: 'Deactivate…' })).toBeNull();
    await user.click(screen.getByRole('menuitem', { name: 'Reactivate' }));

    expect(reactivate).toHaveBeenCalledWith('m-gone');
  });

  /** The API refuses peers and the owner, so nothing is offered for them. */
  it('offers a super admin nothing against the owner', () => {
    actorRole = WorkspaceRole.SUPER_ADMIN;
    render(<AdminMembersPage />);

    expect(screen.queryByRole('button', { name: 'Actions for Olive Owner' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Actions for Robin Admin' })).toBeInTheDocument();
  });

  it('filters by search and status', async () => {
    const user = setupUser();
    render(<AdminMembersPage />);

    await user.type(screen.getByRole('textbox', { name: 'Search people' }), 'robin');
    expect(screen.getByText('1 of 6 people')).toBeInTheDocument();
    expect(screen.queryByText('Pat Member')).toBeNull();

    await user.clear(screen.getByRole('textbox', { name: 'Search people' }));
    await user.click(screen.getByRole('combobox', { name: 'Filter by status' }));
    await user.click(screen.getByRole('option', { name: 'Deactivated' }));
    expect(screen.getByText('1 of 6 people')).toBeInTheDocument();
    expect(screen.getByText('Gone Person')).toBeInTheDocument();
  });

  it('lists only guests on the Guests tab', () => {
    render(<AdminMembersPage guests />);

    expect(screen.getByText('Gale Guest')).toBeInTheDocument();
    expect(screen.queryByText('Pat Member')).toBeNull();
    expect(screen.getByText('1 of 1 person')).toBeInTheDocument();
  });
});
