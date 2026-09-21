import { describe, expect, it } from 'vitest';

import {
  ProjectMemberRole,
  ProjectVisibility,
  WORKSPACE_ROLE_RANK,
  WorkspaceRole,
} from './enums.js';
import {
  canManageProject,
  canSeeProject,
  defaultJoinRole,
  effectiveWorkspaceRole,
  hasProjectAdminOverride,
  lowerRole,
} from './project-roles.js';

const PROJECT_ROLES = [...Object.values(ProjectMemberRole), null] as const;

describe('lowerRole', () => {
  it('returns the less privileged of the two, in either order', () => {
    expect(lowerRole(WorkspaceRole.OWNER, WorkspaceRole.GUEST)).toBe(WorkspaceRole.GUEST);
    expect(lowerRole(WorkspaceRole.GUEST, WorkspaceRole.OWNER)).toBe(WorkspaceRole.GUEST);
    expect(lowerRole(WorkspaceRole.MEMBER, WorkspaceRole.MEMBER)).toBe(WorkspaceRole.MEMBER);
  });
});

describe('effectiveWorkspaceRole', () => {
  /** Otherwise a project admin could edit an admin's standing out from under them. */
  it('lets workspace OWNER and ADMIN keep their role whatever the project says', () => {
    for (const projectRole of PROJECT_ROLES) {
      expect(effectiveWorkspaceRole(WorkspaceRole.OWNER, projectRole)).toBe(WorkspaceRole.OWNER);
      expect(effectiveWorkspaceRole(WorkspaceRole.ADMIN, projectRole)).toBe(WorkspaceRole.ADMIN);
    }
  });

  it('leaves a non-member with their workspace role', () => {
    expect(effectiveWorkspaceRole(WorkspaceRole.MANAGER, null)).toBe(WorkspaceRole.MANAGER);
    expect(effectiveWorkspaceRole(WorkspaceRole.GUEST, null)).toBe(WorkspaceRole.GUEST);
  });

  it('caps an EDITOR at MEMBER and a VIEWER at GUEST', () => {
    expect(effectiveWorkspaceRole(WorkspaceRole.MANAGER, ProjectMemberRole.EDITOR)).toBe(
      WorkspaceRole.MEMBER,
    );
    expect(effectiveWorkspaceRole(WorkspaceRole.MANAGER, ProjectMemberRole.VIEWER)).toBe(
      WorkspaceRole.GUEST,
    );
    expect(effectiveWorkspaceRole(WorkspaceRole.MEMBER, ProjectMemberRole.VIEWER)).toBe(
      WorkspaceRole.GUEST,
    );
  });

  /** A project role narrows; it never widens. */
  it('never raises anyone above their workspace role', () => {
    for (const workspaceRole of Object.values(WorkspaceRole)) {
      for (const projectRole of PROJECT_ROLES) {
        const effective = effectiveWorkspaceRole(workspaceRole, projectRole);
        expect(WORKSPACE_ROLE_RANK[effective]).toBeLessThanOrEqual(
          WORKSPACE_ROLE_RANK[workspaceRole],
        );
      }
    }
  });

  it('gives a project ADMIN their full workspace role', () => {
    expect(effectiveWorkspaceRole(WorkspaceRole.MANAGER, ProjectMemberRole.ADMIN)).toBe(
      WorkspaceRole.MANAGER,
    );
    expect(effectiveWorkspaceRole(WorkspaceRole.GUEST, ProjectMemberRole.ADMIN)).toBe(
      WorkspaceRole.GUEST,
    );
  });
});

describe('canSeeProject', () => {
  it('shows a public project to everyone', () => {
    for (const role of Object.values(WorkspaceRole)) {
      expect(canSeeProject(ProjectVisibility.PUBLIC, role, false)).toBe(true);
    }
  });

  it('shows a private project to its members', () => {
    expect(canSeeProject(ProjectVisibility.PRIVATE, WorkspaceRole.GUEST, true)).toBe(true);
  });

  it('hides a private project from non-members below ADMIN', () => {
    expect(canSeeProject(ProjectVisibility.PRIVATE, WorkspaceRole.MANAGER, false)).toBe(false);
    expect(canSeeProject(ProjectVisibility.PRIVATE, WorkspaceRole.MEMBER, false)).toBe(false);
    expect(canSeeProject(ProjectVisibility.PRIVATE, WorkspaceRole.GUEST, false)).toBe(false);
  });

  /** Nothing is ever unrecoverable. */
  it('shows a private project to workspace OWNER and ADMIN regardless', () => {
    expect(canSeeProject(ProjectVisibility.PRIVATE, WorkspaceRole.OWNER, false)).toBe(true);
    expect(canSeeProject(ProjectVisibility.PRIVATE, WorkspaceRole.ADMIN, false)).toBe(true);
  });
});

describe('canManageProject', () => {
  it('allows a project ADMIN whatever their workspace role', () => {
    expect(canManageProject(WorkspaceRole.MEMBER, ProjectMemberRole.ADMIN)).toBe(true);
  });

  it('allows workspace OWNER and ADMIN without a membership', () => {
    expect(canManageProject(WorkspaceRole.OWNER, null)).toBe(true);
    expect(canManageProject(WorkspaceRole.ADMIN, ProjectMemberRole.VIEWER)).toBe(true);
  });

  it('refuses editors, viewers and non-members below ADMIN', () => {
    expect(canManageProject(WorkspaceRole.MANAGER, ProjectMemberRole.EDITOR)).toBe(false);
    expect(canManageProject(WorkspaceRole.MANAGER, ProjectMemberRole.VIEWER)).toBe(false);
    expect(canManageProject(WorkspaceRole.MANAGER, null)).toBe(false);
  });

  it('agrees with hasProjectAdminOverride for non-members', () => {
    for (const role of Object.values(WorkspaceRole)) {
      expect(canManageProject(role, null)).toBe(hasProjectAdminOverride(role));
    }
  });
});

describe('defaultJoinRole', () => {
  it('makes a guest a viewer and everyone else an editor', () => {
    expect(defaultJoinRole(WorkspaceRole.GUEST)).toBe(ProjectMemberRole.VIEWER);
    expect(defaultJoinRole(WorkspaceRole.MEMBER)).toBe(ProjectMemberRole.EDITOR);
    expect(defaultJoinRole(WorkspaceRole.OWNER)).toBe(ProjectMemberRole.EDITOR);
  });
});
