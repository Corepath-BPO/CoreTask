import type { WorkspaceRole } from '@coretask/contracts';

/**
 * The admin console: what a workspace's super admins see of it as a whole.
 * Every shape here is served under `/workspaces/:id/admin`, to super admins
 * (and the owner) only.
 */

/** Ways an account can sign in, as the console lists them. */
export type AdminSignInMethod = 'PASSWORD' | 'GOOGLE' | 'MICROSOFT' | 'SAML';

/**
 * - `ACTIVE`: can open the workspace.
 * - `DEACTIVATED`: a super admin cut their access off; the membership stays.
 * - `NOT_SIGNED_UP`: an account made for them (by the Asana import, say) that
 *   has never signed in and has no way to yet.
 */
export type AdminMemberStatus = 'ACTIVE' | 'DEACTIVATED' | 'NOT_SIGNED_UP';

export interface AdminPersonRef {
  id: string;
  name: string;
}

export interface AdminMember {
  /** The membership's id, which the member endpoints address. */
  id: string;
  role: WorkspaceRole;
  status: AdminMemberStatus;
  joinedAt: string;
  invitedBy: AdminPersonRef | null;
  deactivatedAt: string | null;
  deactivatedBy: AdminPersonRef | null;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl: string | null;
    jobTitle: string | null;
    /** The last sign-in or session refresh anywhere in CoreTask. */
    lastActiveAt: string | null;
    twoFactorEnabled: boolean;
    emailVerified: boolean;
    signInMethods: AdminSignInMethod[];
  };
  /** Open work assigned to them here. */
  openTasks: number;
  openTickets: number;
}

export interface AdminOverview {
  workspace: {
    id: string;
    name: string;
    createdAt: string;
    owner: { id: string; name: string; email: string } | null;
  };
  people: {
    /** Every membership of a person, whatever its status. */
    total: number;
    active: number;
    deactivated: number;
    notSignedUp: number;
    byRole: Record<WorkspaceRole, number>;
    activeLast7Days: number;
    activeLast30Days: number;
    twoFactorEnabled: number;
  };
  invitations: { pending: number; expired: number };
  teams: number;
  projects: { active: number; archived: number };
  tasks: { open: number; createdLast30Days: number; completedLast30Days: number };
  storage: { files: number; bytes: number };
  automations: { active: number; runsLast7Days: number; failedLast7Days: number };
  sso: { configured: boolean; enabled: boolean; verifiedDomains: string[] };
  /** Null when this workspace never imported from Asana. */
  asana: {
    liveSync: boolean;
    lastRun: { status: string; startedAt: string | null; finishedAt: string | null } | null;
  } | null;
}

export interface AdminTeam {
  id: string;
  name: string;
  description: string | null;
  color: string;
  lead: { id: string; name: string; avatarUrl: string | null } | null;
  memberCount: number;
  projectCount: number;
  createdAt: string;
}

/** Deactivating or removing someone, and who gets their open work. */
export interface AdminHandOverPayload {
  /** An active member to take their open tasks and tickets; omitted, they are unassigned. */
  reassignToUserId?: string | null;
}

export interface AdminDeactivateResult {
  member: AdminMember;
  tasksReassigned: number;
  ticketsReassigned: number;
  tasksUnassigned: number;
  ticketsUnassigned: number;
}

/**
 * A fresh link for a pending invitation, for a super admin to pass on by hand
 * when e-mail does not reach them. Issuing one replaces the previous link.
 */
export interface AdminInvitationLink {
  url: string;
  expiresAt: string;
}
