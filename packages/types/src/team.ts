import type { UserRef } from './work-items.js';

/**
 * A named group of people inside a workspace.
 *
 * Not a permission boundary: `WorkspaceMember.role` still decides what anyone
 * may do. A team answers "who works on this together", and keeping the two
 * apart is what stops moving someone between teams from silently changing what
 * they can see.
 */
export interface Team {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  color: string;
  /** Null when nobody leads it, or the lead has left the workspace. */
  lead: UserRef | null;
  leadId: string | null;
  memberCount: number;
  projectCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A team with its roster, for the detail view. */
export interface TeamDetail extends Team {
  members: UserRef[];
}

export interface CreateTeamPayload {
  name: string;
  description?: string;
  color?: string;
  leadId?: string | null;
}

export interface UpdateTeamPayload {
  name?: string;
  description?: string | null;
  color?: string;
  leadId?: string | null;
}

export interface AddTeamMemberPayload {
  userId: string;
}
