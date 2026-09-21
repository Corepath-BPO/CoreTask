import { ProjectMemberRole, ProjectVisibility, WorkspaceRole } from '@coretask/contracts';
import type { ProjectAccess as ApiAccess } from '@coretask/types';
import { describe, expect, it } from 'vitest';

import { resolveProjectAccess } from './project-access';

const project = (visibility: ProjectVisibility, access: ApiAccess) => ({ visibility, access });

describe('resolveProjectAccess', () => {
  it('falls back to the workspace role when a summary carries no access', () => {
    const result = resolveProjectAccess(null, WorkspaceRole.MANAGER);

    expect(result.effectiveRole).toBe(WorkspaceRole.MANAGER);
    expect(result.canEdit).toBe(true);
    expect(result.canManage).toBe(true);
    expect(result.canJoin).toBe(false);
  });

  it('caps a viewer at guest, whatever their workspace role', () => {
    const result = resolveProjectAccess(
      project(ProjectVisibility.PRIVATE, {
        effectiveRole: WorkspaceRole.GUEST,
        projectRole: ProjectMemberRole.VIEWER,
        isMember: true,
        canManage: false,
      }),
      WorkspaceRole.MANAGER,
    );

    expect(result.effectiveRole).toBe(WorkspaceRole.GUEST);
    expect(result.canEdit).toBe(false);
    expect(result.canManage).toBe(false);
    expect(result.canManageMembers).toBe(false);
    expect(result.canLeave).toBe(true);
    expect(result.isPrivate).toBe(true);
  });

  it('lets an editor edit but not manage', () => {
    const result = resolveProjectAccess(
      project(ProjectVisibility.PUBLIC, {
        effectiveRole: WorkspaceRole.MEMBER,
        projectRole: ProjectMemberRole.EDITOR,
        isMember: true,
        canManage: false,
      }),
      WorkspaceRole.ADMIN,
    );

    expect(result.canEdit).toBe(true);
    expect(result.canManage).toBe(false);
    expect(result.canJoin).toBe(false);
  });

  it('marks a workspace admin on a private project as reaching it by override', () => {
    const result = resolveProjectAccess(
      project(ProjectVisibility.PRIVATE, {
        effectiveRole: WorkspaceRole.ADMIN,
        projectRole: null,
        isMember: false,
        canManage: true,
      }),
      WorkspaceRole.ADMIN,
    );

    expect(result.isAdminOverride).toBe(true);
    expect(result.canManageMembers).toBe(true);
    expect(result.canJoin).toBe(false);
    expect(result.canLeave).toBe(false);
  });

  it('offers Join on a public project the reader is not on', () => {
    const result = resolveProjectAccess(
      project(ProjectVisibility.PUBLIC, {
        effectiveRole: WorkspaceRole.MEMBER,
        projectRole: null,
        isMember: false,
        canManage: false,
      }),
      WorkspaceRole.MEMBER,
    );

    expect(result.canJoin).toBe(true);
    expect(result.canLeave).toBe(false);
    expect(result.isAdminOverride).toBe(false);
  });
});
