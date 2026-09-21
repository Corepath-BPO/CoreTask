import { ProjectMemberRole, ProjectVisibility, WorkspaceRole } from '@coretask/contracts';
import type { ProjectSummary } from '@coretask/types';
import { describe, expect, it, vi } from 'vitest';

import { renderWithRouter, screen, userEvent } from '@/test/test-utils';

import { resolveProjectAccess } from '../lib/project-access';

import { ProjectHeader } from './project-header';

const owner = { id: 'u-owner', name: 'Demo Owner', email: 'demo@coretask.dev', avatarUrl: null };
const maya = { id: 'u-maya', name: 'Maya Okafor', email: 'maya@coretask.dev', avatarUrl: null };

const baseProject: ProjectSummary = {
  id: '019fc880-0000-7000-8000-000000000001',
  workspaceId: '019fc880-0000-7000-8000-0000000000ff',
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
  taskCount: 2,
  completedTaskCount: 0,
  sectionCount: 4,
  memberCount: 2,
  members: [
    { user: owner, role: ProjectMemberRole.ADMIN },
    { user: maya, role: ProjectMemberRole.ADMIN },
  ],
  access: {
    effectiveRole: WorkspaceRole.OWNER,
    projectRole: ProjectMemberRole.ADMIN,
    isMember: true,
    canManage: true,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

async function renderHeader(
  overrides: Partial<ProjectSummary> = {},
  workspaceRole: WorkspaceRole = WorkspaceRole.OWNER,
) {
  const project = { ...baseProject, ...overrides };
  const handlers = {
    onEdit: vi.fn(),
    onArchive: vi.fn(),
    onShare: vi.fn(),
    onJoin: vi.fn(),
    onLeave: vi.fn(),
    onSetStatus: vi.fn(),
    onCustomize: vi.fn(),
  };

  await renderWithRouter(() => (
    <ProjectHeader
      project={project}
      access={resolveProjectAccess(project, workspaceRole)}
      statusUpdate={null}
      customizeOpen={false}
      {...handlers}
    />
  ));

  return handlers;
}

describe('ProjectHeader', () => {
  it('shows the padlock on a private project and not on a public one', async () => {
    await renderHeader();
    expect(screen.getByRole('img', { name: 'Private project' })).toBeInTheDocument();
  });

  it('leaves the padlock off a public project', async () => {
    await renderHeader({ visibility: ProjectVisibility.PUBLIC });
    expect(screen.queryByRole('img', { name: 'Private project' })).not.toBeInTheDocument();
  });

  it('offers Share to a member and opens it from the avatar stack too', async () => {
    const handlers = await renderHeader();
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^share$/i }));
    await user.click(screen.getByRole('button', { name: '2 members. Open sharing' }));

    expect(handlers.onShare).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: /^join$/i })).not.toBeInTheDocument();
  });

  it('offers Join, and no Leave, to a non-member of a public project', async () => {
    const handlers = await renderHeader(
      {
        visibility: ProjectVisibility.PUBLIC,
        access: {
          effectiveRole: WorkspaceRole.MEMBER,
          projectRole: null,
          isMember: false,
          canManage: false,
        },
      },
      WorkspaceRole.MEMBER,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^join$/i }));
    expect(handlers.onJoin).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: /actions for leadership planning/i }));
    expect(screen.queryByRole('menuitem', { name: /leave project/i })).not.toBeInTheDocument();
  });

  it('names the admin override on a private project the reader is not on', async () => {
    await renderHeader(
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

    expect(screen.getByText('Admin access')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^join$/i })).not.toBeInTheDocument();
  });

  it('gives a viewer a read-only row: no actions caret beyond Leave', async () => {
    await renderHeader(
      {
        access: {
          effectiveRole: WorkspaceRole.GUEST,
          projectRole: ProjectMemberRole.VIEWER,
          isMember: true,
          canManage: false,
        },
      },
      WorkspaceRole.MANAGER,
    );
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /actions for leadership planning/i }));
    expect(screen.getByRole('menuitem', { name: /leave project/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /edit project/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /archive project/i })).not.toBeInTheDocument();
  });
});
