import type { PaginationMeta } from '@coretask/types';
import type { Request } from 'express';

/** Identity attached to the request by the JWT strategy. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  /** Session id, tying this access token to a refresh-token family. */
  sessionId: string;
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
