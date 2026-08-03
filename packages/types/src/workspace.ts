import type { WorkspaceRole } from '@coretask/contracts';

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
  expiresAt: string;
}

export interface CreateInvitationPayload {
  email: string;
  role: WorkspaceRole;
}

export interface AcceptInvitationResult {
  workspaceId: string;
  workspaceSlug: string;
  role: WorkspaceRole;
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
