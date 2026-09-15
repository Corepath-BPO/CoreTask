import type { ProjectMemberRole, WorkspaceRole } from '@coretask/contracts';

import type { UserRef } from './work-items.js';

/**
 * One member of a project — a row in the Share dialog.
 *
 * Always somebody who is also in the workspace; the API refuses anyone else
 * and drops the row when they leave the workspace.
 */
export interface ProjectMember {
  projectId: string;
  workspaceId: string;
  userId: string;
  role: ProjectMemberRole;
  user: UserRef;
  addedAt: string;
}

/** Just enough of a member to draw an avatar in a stack. */
export interface ProjectMemberPreview {
  user: UserRef;
  role: ProjectMemberRole;
}

/**
 * The caller's own standing in one project, computed by the API per request.
 *
 * `effectiveRole` is the workspace role after the project role's cap, and is
 * what every "can I edit this" check on a project screen should read;
 * `canManage` is whether the caller may change members and privacy.
 */
export interface ProjectAccess {
  effectiveRole: WorkspaceRole;
  /** Null when the caller is not a member (a public project, or the admin override). */
  projectRole: ProjectMemberRole | null;
  isMember: boolean;
  canManage: boolean;
}

export interface AddProjectMemberPayload {
  userId: string;
  role: ProjectMemberRole;
}

export interface UpdateProjectMemberRolePayload {
  role: ProjectMemberRole;
}
