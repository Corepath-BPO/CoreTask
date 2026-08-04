/**
 * Domain enums shared by the web client and the API.
 *
 * These are declared as frozen const objects rather than TypeScript `enum`s so
 * that the package stays free of emitted runtime helpers and works identically
 * under CJS, ESM and bundlers.
 *
 * They intentionally mirror the Prisma enums 1:1. `api/test/unit/enum-parity.spec.ts`
 * asserts the two stay in sync, so a schema change that is not reflected here
 * fails the API test suite instead of drifting silently.
 */

export const WorkspaceRole = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  MEMBER: 'MEMBER',
  GUEST: 'GUEST',
} as const;
export type WorkspaceRole = (typeof WorkspaceRole)[keyof typeof WorkspaceRole];
export const WORKSPACE_ROLES = Object.values(WorkspaceRole);

/** Ordered from most to least privileged — used for `hasAtLeastRole` checks. */
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = {
  OWNER: 50,
  ADMIN: 40,
  MANAGER: 30,
  MEMBER: 20,
  GUEST: 10,
};

export const ProjectStatus = {
  PLANNING: 'PLANNING',
  ACTIVE: 'ACTIVE',
  ON_HOLD: 'ON_HOLD',
  COMPLETED: 'COMPLETED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProjectStatus = (typeof ProjectStatus)[keyof typeof ProjectStatus];
export const PROJECT_STATUSES = Object.values(ProjectStatus);

export const TaskPriority = {
  NONE: 'NONE',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;
export type TaskPriority = (typeof TaskPriority)[keyof typeof TaskPriority];
export const TASK_PRIORITIES = Object.values(TaskPriority);

export const TaskStatus = {
  BACKLOG: 'BACKLOG',
  TODO: 'TODO',
  IN_PROGRESS: 'IN_PROGRESS',
  IN_REVIEW: 'IN_REVIEW',
  BLOCKED: 'BLOCKED',
  DONE: 'DONE',
  CANCELLED: 'CANCELLED',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = Object.values(TaskStatus);

/** Statuses that mean "no longer active work" — used for dashboard rollups. */
export const CLOSED_TASK_STATUSES: readonly TaskStatus[] = [TaskStatus.DONE, TaskStatus.CANCELLED];

export const TicketType = {
  BUG: 'BUG',
  FEATURE: 'FEATURE',
  SUPPORT: 'SUPPORT',
  QUESTION: 'QUESTION',
  MAINTENANCE: 'MAINTENANCE',
  INCIDENT: 'INCIDENT',
} as const;
export type TicketType = (typeof TicketType)[keyof typeof TicketType];
export const TICKET_TYPES = Object.values(TicketType);

export const TicketPriority = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
} as const;
export type TicketPriority = (typeof TicketPriority)[keyof typeof TicketPriority];
export const TICKET_PRIORITIES = Object.values(TicketPriority);

export const TicketSeverity = {
  MINOR: 'MINOR',
  MAJOR: 'MAJOR',
  CRITICAL: 'CRITICAL',
} as const;
export type TicketSeverity = (typeof TicketSeverity)[keyof typeof TicketSeverity];
export const TICKET_SEVERITIES = Object.values(TicketSeverity);

export const TicketStatus = {
  OPEN: 'OPEN',
  TRIAGED: 'TRIAGED',
  IN_PROGRESS: 'IN_PROGRESS',
  WAITING: 'WAITING',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];
export const TICKET_STATUSES = Object.values(TicketStatus);

export const CLOSED_TICKET_STATUSES: readonly TicketStatus[] = [
  TicketStatus.RESOLVED,
  TicketStatus.CLOSED,
];

export const NotificationType = {
  TASK_ASSIGNED: 'TASK_ASSIGNED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  TASK_DUE_SOON: 'TASK_DUE_SOON',
  TICKET_ASSIGNED: 'TICKET_ASSIGNED',
  TICKET_STATUS_CHANGED: 'TICKET_STATUS_CHANGED',
  COMMENT_CREATED: 'COMMENT_CREATED',
  MENTIONED: 'MENTIONED',
  WORKSPACE_INVITE: 'WORKSPACE_INVITE',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
export const NOTIFICATION_TYPES = Object.values(NotificationType);

export const ActivityAction = {
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  DELETED: 'DELETED',
  ARCHIVED: 'ARCHIVED',
  RESTORED: 'RESTORED',
  ASSIGNED: 'ASSIGNED',
  UNASSIGNED: 'UNASSIGNED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  COMMENTED: 'COMMENTED',
  MEMBER_ADDED: 'MEMBER_ADDED',
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEMBER_ROLE_CHANGED: 'MEMBER_ROLE_CHANGED',
} as const;
export type ActivityAction = (typeof ActivityAction)[keyof typeof ActivityAction];
export const ACTIVITY_ACTIONS = Object.values(ActivityAction);

export const ActivityEntity = {
  WORKSPACE: 'WORKSPACE',
  WORKSPACE_MEMBER: 'WORKSPACE_MEMBER',
  PROJECT: 'PROJECT',
  SECTION: 'SECTION',
  TASK: 'TASK',
  TICKET: 'TICKET',
  COMMENT: 'COMMENT',
  USER: 'USER',
} as const;
export type ActivityEntity = (typeof ActivityEntity)[keyof typeof ActivityEntity];
export const ACTIVITY_ENTITIES = Object.values(ActivityEntity);

export const CommentEntity = {
  TASK: 'TASK',
  TICKET: 'TICKET',
} as const;
export type CommentEntity = (typeof CommentEntity)[keyof typeof CommentEntity];
export const COMMENT_ENTITIES = Object.values(CommentEntity);

/** True when `role` is at least as privileged as `required`. */
export function hasAtLeastRole(role: WorkspaceRole, required: WorkspaceRole): boolean {
  return WORKSPACE_ROLE_RANK[role] >= WORKSPACE_ROLE_RANK[required];
}

/**
 * Whether `actor` may hand out `target` when inviting.
 *
 * Two rules, and both matter:
 *
 * - You cannot grant a role above your own. Otherwise an admin invites someone
 *   as owner, and privilege escalation is one invitation away.
 * - `OWNER` is never grantable. A workspace has one owner and changing that is a
 *   transfer, not an invitation — conflating them means an owner can be added
 *   by surprise.
 */
export function canGrantRole(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (target === WorkspaceRole.OWNER) return false;
  return WORKSPACE_ROLE_RANK[actor] >= WORKSPACE_ROLE_RANK[target];
}

/** The roles `actor` is allowed to offer, for populating a picker. */
export function grantableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  return WORKSPACE_ROLES.filter((role) => canGrantRole(actor, role));
}

/**
 * Whether `actor` may change or remove a member currently holding `target`.
 *
 * Strictly greater, not "at least": peers must not be able to demote or eject
 * one another, or two admins can race to remove each other and whoever clicks
 * first wins the workspace. It also rules out acting on yourself, which is what
 * keeps a lone owner from demoting themselves into a workspace nobody owns —
 * leaving and transferring ownership are separate, deliberate actions.
 */
export function canManageMember(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  return WORKSPACE_ROLE_RANK[actor] > WORKSPACE_ROLE_RANK[target];
}
