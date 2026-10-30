import type { ProjectMemberRole, WorkspaceRole } from '@coretask/contracts';

import type { OutOfOffice } from './auth.js';

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  /** Ticket key prefix, e.g. `CORE` yields `CORE-1001`. */
  ticketPrefix: string;
  createdAt: string;
  updatedAt: string;
}

/** A workspace as it appears in the current user's workspace list / switcher. */
export interface WorkspaceSummary extends Workspace {
  /** The requesting user's role in this workspace. */
  role: WorkspaceRole;
  memberCount: number;
  projectCount: number;
}

export interface WorkspaceMember {
  id: string;
  workspaceId: string;
  role: WorkspaceRole;
  joinedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    jobTitle?: string | null;
    pronouns?: string | null;
    /** Their time off, if set — pickers say "out of office" from it. */
    outOfOffice?: OutOfOffice | null;
  };
}

/**
 * A pending offer of membership.
 *
 * The token is absent on purpose: it exists in one e-mail link and as a hash in
 * the database, and listing invitations must never hand it back — anyone who
 * can read the list could otherwise accept on someone else's behalf.
 */
export interface WorkspaceInvitation {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  /** Null when the inviter's account has since been removed. */
  invitedBy: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
  } | null;
  /** Team they join on acceptance, if the invitation named one. */
  team: { id: string; name: string; color: string } | null;
  /** Project they join on acceptance, from a project's Share dialog. */
  project: { id: string; name: string; role: ProjectMemberRole } | null;
  expiresAt: string;
  /** True once `expiresAt` has passed; the API decides, not the client's clock. */
  expired: boolean;
  createdAt: string;
}

/**
 * What the accept page can show before anyone signs in.
 *
 * Deliberately thin. The holder of a link is not yet a member, so this exposes
 * only what is needed to decide whether to accept — never the member list, and
 * never anything about the workspace's contents.
 */
export interface WorkspaceInvitationPreview {
  workspaceName: string;
  /** The address it was sent to; the accepting account must match it. */
  email: string;
  role: WorkspaceRole;
  invitedByName: string | null;
  /** Name only — enough to say what they are joining, nothing about its people. */
  teamName: string | null;
  /** The project an invitation from a Share dialog lands them in; name only. */
  projectName: string | null;
  expiresAt: string;
}

export interface CreateInvitationPayload {
  email: string;
  role: WorkspaceRole;
  /** Optional. Must be a team in the same workspace. */
  teamId?: string | null;
}

export interface UpdateMemberRolePayload {
  role: WorkspaceRole;
}

/** What removing a member did, beyond ending their access. */
export interface RemoveMemberResult {
  removed: true;
  /** Open tasks handed to the member a super admin named, where they can open them. */
  tasksReassigned: number;
  ticketsReassigned: number;
  /** Open tasks that were unassigned, because the assignee can no longer see them. */
  tasksUnassigned: number;
  ticketsUnassigned: number;
  /** Teams in this workspace the person was dropped from. */
  teamsLeft: number;
}

export interface AcceptInvitationResult {
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  /** The project they were added to, so the app can open it; null otherwise. */
  projectId: string | null;
}

/**
 * Invites someone outside the workspace into one project. They join the
 * workspace as a member (a guest for VIEWER, which is all a viewer acts as)
 * and the project at this role.
 */
export interface CreateProjectInvitationPayload {
  email: string;
  role: ProjectMemberRole;
}

export interface CreateWorkspacePayload {
  name: string;
  slug?: string;
  description?: string;
}

export interface UpdateWorkspacePayload {
  name?: string;
  description?: string | null;
  logoUrl?: string | null;
}
