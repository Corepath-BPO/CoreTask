import {
  ProjectVisibility,
  WorkspaceRole,
  hasAtLeastRole,
  hasProjectAdminOverride,
  type ProjectMemberRole,
} from '@coretask/contracts';
import type { ProjectSummary } from '@coretask/types';
import { useMemo } from 'react';

import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';

/**
 * What the reader may do on one project, in the terms the screens ask.
 *
 * The API computes `access` per reader on every project summary; this is the
 * one place that turns it into `canEdit` / `canManage` / `canManageMembers`, so
 * a project screen never reaches for the workspace role directly. A project
 * role only ever lowers that role — an EDITOR acts as at most a MEMBER, a
 * VIEWER as at most a GUEST — so a workspace manager who is a viewer here gets
 * a read-only screen, which is what the API would enforce anyway.
 */
export interface ProjectAccess {
  /** The workspace role after the project role's cap. */
  effectiveRole: WorkspaceRole;
  isMember: boolean;
  projectRole: ProjectMemberRole | null;
  isPrivate: boolean;
  /** MEMBER or better here: may add and edit work. */
  canEdit: boolean;
  /** MANAGER or better here: may archive, delete sections, manage rules. */
  canManage: boolean;
  /** A project admin, or a workspace admin: may change the roster and the privacy. */
  canManageMembers: boolean;
  /** A public project the reader is not on: the Join button. */
  canJoin: boolean;
  canLeave: boolean;
  /** Reached a private project as a workspace admin rather than as a member. */
  isAdminOverride: boolean;
}

type AccessSource = Pick<ProjectSummary, 'visibility' | 'access'> | null | undefined;

export function resolveProjectAccess(
  project: AccessSource,
  workspaceRole: WorkspaceRole,
): ProjectAccess {
  // A summary from before privacy existed carries no `access`; the workspace
  // role is then exactly what the screen used to read.
  const effectiveRole = project?.access?.effectiveRole ?? workspaceRole;
  const projectRole = project?.access?.projectRole ?? null;
  const isMember = project?.access?.isMember ?? false;
  const isPrivate = project?.visibility === ProjectVisibility.PRIVATE;
  const canManageMembers = project?.access?.canManage ?? hasProjectAdminOverride(workspaceRole);

  return {
    effectiveRole,
    isMember,
    projectRole,
    isPrivate,
    canEdit: hasAtLeastRole(effectiveRole, WorkspaceRole.MEMBER),
    canManage: hasAtLeastRole(effectiveRole, WorkspaceRole.MANAGER),
    canManageMembers,
    canJoin: project != null && !isMember && !isPrivate,
    canLeave: isMember,
    isAdminOverride: isPrivate && !isMember && canManageMembers,
  };
}

/** `resolveProjectAccess` against the active workspace's role. */
export function useProjectAccess(project: AccessSource): ProjectAccess {
  const { workspace } = useActiveWorkspace();
  const workspaceRole = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;

  return useMemo(() => resolveProjectAccess(project, workspaceRole), [project, workspaceRole]);
}
