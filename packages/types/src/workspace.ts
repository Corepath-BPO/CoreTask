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
