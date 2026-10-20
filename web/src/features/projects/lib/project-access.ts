import {
  ProjectMemberRole,
  ProjectVisibility,
  WorkspaceRole,
  effectiveConversationRole,
  hasAtLeastRole,
  hasProjectAdminOverride,
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
 * COMMENTER or a VIEWER as at most a GUEST — so a workspace manager who is a
 * viewer here gets a read-only screen, which is what the API would enforce
 * anyway. A COMMENTER differs from a VIEWER only in `canComment`.
 */
export interface ProjectAccess {
  /** The workspace role after the project role's cap. */
  effectiveRole: WorkspaceRole;
  isMember: boolean;
  projectRole: ProjectMemberRole | null;
  isPrivate: boolean;
  /** MEMBER or better here: may add and edit work. */
  canEdit: boolean;
  /** May comment, like and reply: an editor, or a COMMENTER, who may do nothing else. */
  canComment: boolean;
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
    canComment: hasAtLeastRole(
      conversationRole(effectiveRole, projectRole, workspaceRole),
      WorkspaceRole.MEMBER,
    ),
    canManage: hasAtLeastRole(effectiveRole, WorkspaceRole.MANAGER),
    canManageMembers,
    canJoin: project != null && !isMember && !isPrivate,
    canLeave: isMember,
    isAdminOverride: isPrivate && !isMember && canManageMembers,
  };
}

/**
 * The role one item is acted on with, for a screen that may not hold the
 * item's project yet.
 *
 * An item outside any project answers to the workspace role alone. Inside one,
 * the project caps that role — and until the project has arrived the cap is
 * unknown, so this answers with the lowest role rather than the uncapped one.
 * Reaching for the workspace role in the meantime handed a viewer an editable
 * panel for as long as the fetch took, and kept it editable if the fetch never
 * landed. The API refuses the write either way; this is about not offering it.
 */
export function roleForProjectItem(
  projectId: string | null | undefined,
  project: AccessSource,
  workspaceRole: WorkspaceRole,
): WorkspaceRole {
  if (!projectId) return workspaceRole;
  if (!project) return WorkspaceRole.GUEST;

  return resolveProjectAccess(project, workspaceRole).effectiveRole;
}

/**
 * The role an item's conversation is joined with: `roleForProjectItem`, with
 * a project COMMENTER counted as an editor — for the comment thread, which a
 * commenter writes in although the rest of the panel stays read-only.
 */
export function conversationRoleForProjectItem(
  projectId: string | null | undefined,
  project: AccessSource,
  workspaceRole: WorkspaceRole,
): WorkspaceRole {
  const role = roleForProjectItem(projectId, project, workspaceRole);
  if (!projectId || !project) return role;
  return conversationRole(role, project.access?.projectRole ?? null, workspaceRole);
}

/** The API's effective role, lifted for a COMMENTER as `effectiveConversationRole` says. */
function conversationRole(
  effectiveRole: WorkspaceRole,
  projectRole: ProjectMemberRole | null,
  workspaceRole: WorkspaceRole,
): WorkspaceRole {
  return projectRole === ProjectMemberRole.COMMENTER
    ? effectiveConversationRole(workspaceRole, projectRole)
    : effectiveRole;
}

/** `resolveProjectAccess` against the active workspace's role. */
export function useProjectAccess(project: AccessSource): ProjectAccess {
  const { workspace } = useActiveWorkspace();
  const workspaceRole = (workspace?.role ?? WorkspaceRole.GUEST) as WorkspaceRole;

  return useMemo(() => resolveProjectAccess(project, workspaceRole), [project, workspaceRole]);
}
