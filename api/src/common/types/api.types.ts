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

/** Membership resolved by `WorkspaceMemberGuard`, scoped to the current request. */
export interface WorkspaceContext {
  workspaceId: string;
  membershipId: string;
  role: string;
}

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
  workspace?: WorkspaceContext;
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
