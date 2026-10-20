/**
 * How a project's own roles combine with the workspace roles.
 *
 * A project role never grants anything the workspace did not: it can only
 * lower what someone may do inside that one project. The one exception runs
 * the other way — workspace OWNER and ADMIN see and manage every project
 * without a membership row, so a private project whose admins have all left
 * is still reachable by someone.
 *
 * Shared so the API enforces exactly what the Share dialog offers.
 */

import {
  ProjectMemberRole,
  ProjectVisibility,
  WORKSPACE_ROLE_RANK,
  WorkspaceRole,
  hasAtLeastRole,
} from './enums.js';

/** Ordered from most to least privileged, for sorting a roster. */
export const PROJECT_MEMBER_ROLE_RANK: Record<ProjectMemberRole, number> = {
  ADMIN: 30,
  EDITOR: 20,
  COMMENTER: 15,
  VIEWER: 10,
};

/**
 * The ceiling a project role puts on the workspace role inside that project.
 * `null` means no ceiling: an ADMIN acts with their full workspace role.
 */
export const PROJECT_ROLE_CAP: Record<ProjectMemberRole, WorkspaceRole | null> = {
  ADMIN: null,
  EDITOR: WorkspaceRole.MEMBER,
  // Read-only for the work itself; `effectiveConversationRole` lifts it for
  // comments, likes and replies.
  COMMENTER: WorkspaceRole.GUEST,
  VIEWER: WorkspaceRole.GUEST,
};

/** The less privileged of two workspace roles. */
export function lowerRole(a: WorkspaceRole, b: WorkspaceRole): WorkspaceRole {
  return WORKSPACE_ROLE_RANK[a] <= WORKSPACE_ROLE_RANK[b] ? a : b;
}

/** Workspace OWNER and ADMIN reach every project, member or not. */
export function hasProjectAdminOverride(workspaceRole: WorkspaceRole): boolean {
  return hasAtLeastRole(workspaceRole, WorkspaceRole.ADMIN);
}

/**
 * The role someone acts with inside a project.
 *
 * The override wins first: an admin's standing does not depend on a row that
 * a project admin could edit. Otherwise a non-member keeps their workspace
 * role (only meaningful on a public project — on a private one they cannot
 * see it at all), and a member is capped by their project role.
 */
export function effectiveWorkspaceRole(
  workspaceRole: WorkspaceRole,
  projectRole: ProjectMemberRole | null,
): WorkspaceRole {
  if (hasProjectAdminOverride(workspaceRole)) return workspaceRole;
  if (projectRole === null) return workspaceRole;
  const cap = PROJECT_ROLE_CAP[projectRole];
  return cap === null ? workspaceRole : lowerRole(workspaceRole, cap);
}

/**
 * The role someone takes part in a project's conversations with: comments
 * on its tasks and tickets, likes, and replies to its messages. The same as
 * `effectiveWorkspaceRole`, except that a COMMENTER counts as an EDITOR here
 * — that is the whole of the role. The workspace role still caps it, so a
 * workspace GUEST made a commenter stays read-only: a project role never
 * grants what the workspace did not.
 */
export function effectiveConversationRole(
  workspaceRole: WorkspaceRole,
  projectRole: ProjectMemberRole | null,
): WorkspaceRole {
  return effectiveWorkspaceRole(
    workspaceRole,
    projectRole === ProjectMemberRole.COMMENTER ? ProjectMemberRole.EDITOR : projectRole,
  );
}

/** Whether a project is visible to someone at all. */
export function canSeeProject(
  visibility: ProjectVisibility,
  workspaceRole: WorkspaceRole,
  isMember: boolean,
): boolean {
  if (visibility === ProjectVisibility.PUBLIC) return true;
  return isMember || hasProjectAdminOverride(workspaceRole);
}

/** Whether someone may change a project's members and its privacy. */
export function canManageProject(
  workspaceRole: WorkspaceRole,
  projectRole: ProjectMemberRole | null,
): boolean {
  return hasProjectAdminOverride(workspaceRole) || projectRole === ProjectMemberRole.ADMIN;
}

/**
 * The role someone gets when they join a public project themselves. A guest
 * is read-only everywhere, so a VIEWER row says the same thing honestly.
 */
export function defaultJoinRole(workspaceRole: WorkspaceRole): ProjectMemberRole {
  return workspaceRole === WorkspaceRole.GUEST
    ? ProjectMemberRole.VIEWER
    : ProjectMemberRole.EDITOR;
}
