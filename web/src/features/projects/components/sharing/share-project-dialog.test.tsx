import { ProjectMemberRole, ProjectVisibility, WorkspaceRole } from '@coretask/contracts';
import type { ProjectMember, ProjectSummary } from '@coretask/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent, within } from '@/test/test-utils';

import { resolveProjectAccess } from '../../lib/project-access';

import { ShareProjectDialog } from './share-project-dialog';

const owner = { id: 'u-owner', name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null };
const maya = { id: 'u-maya', name: 'Maya Okafor', email: 'maya@coretask.dev', avatarUrl: null };
const jonas = { id: 'u-jonas', name: 'Jonas Feld', email: 'jonas@coretask.dev', avatarUrl: null };

const member = (
  user: typeof owner,
  role: ProjectMemberRole,
  projectId = '019fc880-0000-7000-8000-000000000001',
): ProjectMember => ({
  projectId,
  workspaceId: 'ws-1',
  userId: user.id,
  role,
  user,
  addedAt: '2026-01-01T00:00:00.000Z',
});

const project: ProjectSummary = {
  id: '019fc880-0000-7000-8000-000000000001',
  workspaceId: 'ws-1',
  name: 'Leadership Planning',
  key: 'LEAD',
  description: null,
  status: 'ACTIVE',
  color: '#8B5CF6',
  defaultWorkItemType: 'TASK',
  visibility: ProjectVisibility.PRIVATE,
  leadId: owner.id,
  lead: owner,
  teamId: null,
  team: null,
  startDate: null,
  dueDate: null,
  completedAt: null,
  archivedAt: null,
  taskCount: 0,
  completedTaskCount: 0,
  sectionCount: 4,
  memberCount: 2,
  members: [],
  access: {
    effectiveRole: WorkspaceRole.OWNER,
    projectRole: ProjectMemberRole.ADMIN,
    isMember: true,
    canManage: true,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const membersState: { data: ProjectMember[]; isLoading: boolean } = {
  data: [],
  isLoading: false,
};
const addMutate = vi.fn();
const updateRoleMutate = vi.fn();
const removeMutate = vi.fn();
const leaveMutate = vi.fn();
const updateProjectMutate = vi.fn();
let me: typeof owner = owner;

vi.mock('../../hooks/use-project-members', () => ({
  useProjectMembers: () => membersState,
  useAddProjectMember: () => ({ mutate: addMutate, isPending: false }),
  useUpdateProjectMemberRole: () => ({ mutate: updateRoleMutate, isPending: false }),
  useRemoveProjectMember: () => ({ mutate: removeMutate, isPending: false }),
  useLeaveProject: () => ({ mutate: leaveMutate, isPending: false }),
}));

vi.mock('../../hooks/use-projects', () => ({
  useUpdateProject: () => ({ mutate: updateProjectMutate, isPending: false }),
}));

vi.mock('@/features/workspaces/hooks/use-workspaces', () => ({
  useWorkspaceMembers: () => ({
    data: [
      { id: 'm1', workspaceId: 'ws-1', role: 'OWNER', joinedAt: '', user: owner },
      { id: 'm2', workspaceId: 'ws-1', role: 'ADMIN', joinedAt: '', user: maya },
      { id: 'm3', workspaceId: 'ws-1', role: 'MEMBER', joinedAt: '', user: jonas },
    ],
  }),
}));

vi.mock('@/stores/auth.store', () => ({
  useCurrentUser: () => me,
}));

async function open(
  overrides: Partial<ProjectSummary> = {},
  workspaceRole: WorkspaceRole = WorkspaceRole.OWNER,
) {
  const merged = { ...project, ...overrides };
  const onOpenChange = vi.fn();
  const onLeft = vi.fn();

  await renderWithRouter(() => (
    <ShareProjectDialog
      open
      onOpenChange={onOpenChange}
      workspaceId="ws-1"
      project={merged}
      access={resolveProjectAccess(merged, workspaceRole)}
      onLeft={onLeft}
    />
  ));

  return { onOpenChange, onLeft };
}

describe('ShareProjectDialog', () => {
  beforeEach(() => {
    membersState.data = [
      member(owner, ProjectMemberRole.ADMIN),
      member(maya, ProjectMemberRole.ADMIN),
    ];
    membersState.isLoading = false;
    me = owner;
    vi.clearAllMocks();
  });

  it('lists the roster with a role picker per row for a project admin', async () => {
    await open();

    const list = screen.getByRole('list', { name: 'Project members' });
    expect(within(list).getByText('Maya Okafor')).toBeInTheDocument();
    expect(within(list).getByText('(you)')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Maya Okafor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add people' })).toBeInTheDocument();
  });

  it('removes somebody else and reports who', async () => {
    await open();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: 'Remove Maya Okafor from Leadership Planning' }),
    );

    expect(removeMutate).toHaveBeenCalledWith({ userId: maya.id, name: maya.name });
  });

  it('locks the last admin of a private project with a reason', async () => {
    membersState.data = [
      member(owner, ProjectMemberRole.ADMIN),
      member(maya, ProjectMemberRole.VIEWER),
    ];
    await open();

    const picker = screen.getByRole('combobox', { name: 'Role for Demo Owner' });
    expect(picker).toBeDisabled();
    expect(picker).toHaveAttribute('title', expect.stringMatching(/at least one admin/i));
    // Maya, a viewer, can still be changed.
    expect(screen.getByRole('combobox', { name: 'Role for Maya Okafor' })).toBeEnabled();
  });

  it('does not apply the last-admin rule to a public project', async () => {
    membersState.data = [member(owner, ProjectMemberRole.ADMIN)];
    await open({ visibility: ProjectVisibility.PUBLIC });

    expect(screen.getByRole('combobox', { name: 'Role for Demo Owner' })).toBeEnabled();
  });

  it('gives a non-admin a read-only roster with a Leave on their own row', async () => {
    me = maya;
    membersState.data = [
      member(owner, ProjectMemberRole.ADMIN),
      member(maya, ProjectMemberRole.EDITOR),
    ];
    await open(
      {
        visibility: ProjectVisibility.PUBLIC,
        access: {
          effectiveRole: WorkspaceRole.MEMBER,
          projectRole: ProjectMemberRole.EDITOR,
          isMember: true,
          canManage: false,
        },
      },
      WorkspaceRole.ADMIN,
    );
    const user = userEvent.setup();

    expect(screen.queryByRole('button', { name: 'Add people' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /role for/i })).not.toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /leave project/i }));
    // Public, so no confirmation stands between the click and the request.
    expect(leaveMutate).toHaveBeenCalledWith(
      { projectId: project.id, name: project.name },
      expect.anything(),
    );
  });

  it('asks before leaving a private project', async () => {
    me = maya;
    await open({
      access: {
        effectiveRole: WorkspaceRole.ADMIN,
        projectRole: ProjectMemberRole.ADMIN,
        isMember: true,
        canManage: true,
      },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /leave project/i }));
    expect(leaveMutate).not.toHaveBeenCalled();

    const confirm = screen.getByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: /leave project/i }));
    expect(leaveMutate).toHaveBeenCalledTimes(1);
  });

  it('says why a workspace admin can see a private project they are not on', async () => {
    membersState.data = [member(maya, ProjectMemberRole.ADMIN)];
    await open(
      {
        access: {
          effectiveRole: WorkspaceRole.ADMIN,
          projectRole: null,
          isMember: false,
          canManage: true,
        },
      },
      WorkspaceRole.ADMIN,
    );

    expect(screen.getByText(/as a workspace admin; you are not a member/i)).toBeInTheDocument();
  });
});
