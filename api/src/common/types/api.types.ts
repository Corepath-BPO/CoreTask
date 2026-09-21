import type { ProjectMemberRole, ProjectVisibility, WorkspaceRole } from '@coretask/contracts';
import type { PaginationMeta } from '@coretask/types';
import type { Request } from 'express';

/** The key that authenticated a request, when one did. */
export interface ApiKeyPrincipal {
  id: string;
  workspaceId: string;
  name: string;
}

/** Identity attached to the request by `JwtAuthGuard` — a session or an API key. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  /**
   * Session id, tying this access token to a refresh-token family. Null when
   * an API key authenticated the request: a key has no session to revoke.
   */
  sessionId: string | null;
  /** Present when a workspace API key authenticated the request. */
  apiKey?: ApiKeyPrincipal;
}

/**
 * Membership resolved by `WorkspaceMemberGuard`, scoped to the current request.
 *
 * On a route under a project, `ProjectAccessGuard` lowers `role` to the
 * caller's *effective* role inside that project, so everything downstream that
 * reads it honours the project's cap without knowing projects exist.
 */
export interface WorkspaceContext {
  workspaceId: string;
  membershipId: string;
  role: WorkspaceRole;
}

/** Who is acting, with the role they act with here. What services take instead of a bare user id. */
export interface ActorContext {
  userId: string;
  role: WorkspaceRole;
}

/** The caller's standing in the project a route is under, resolved by `ProjectAccessGuard`. */
export interface ProjectAccessContext {
  projectId: string;
  workspaceId: string;
  visibility: ProjectVisibility;
  /** Null when the caller is not on the roster (public project, or the admin override). */
  projectRole: ProjectMemberRole | null;
  isMember: boolean;
  /** The workspace role after the project role's cap. */
  effectiveRole: WorkspaceRole;
  /** May change the roster and the project's privacy. */
  canManage: boolean;
  /** Reached the project as a workspace OWNER/ADMIN rather than as a member. */
  override: boolean;
}

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
  workspace?: WorkspaceContext;
  project?: ProjectAccessContext;
}

/**
 * Marker returned by controllers that page their results.
 *
 * The response interceptor recognises it and lifts `meta` into the envelope
 * instead of nesting it inside `data`.
 */
export class PaginatedResult<TItem, TMeta extends PaginationMeta = PaginationMeta> {
  constructor(
    readonly items: TItem[],
    /**
     * Endpoints may widen this with extra rollups — the interceptor passes it
     * through untouched, so a list can ship its own summary without inventing a
     * second response shape.
     */
    readonly meta: TMeta,
  ) {}
}
