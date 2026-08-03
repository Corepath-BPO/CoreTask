import { hasAtLeastRole, type WorkspaceRole } from '@coretask/contracts';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { WORKSPACE_ROLES_KEY } from '../../common/decorators/workspace.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import type { RequestWithUser } from '../../common/types/api.types';

import { WorkspaceMembersService } from './workspace-members.service';

/** Accepts any RFC 4122 version, including the v7 ids this schema generates. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Enforces tenant isolation for any route carrying a `:workspaceId` parameter.
 *
 * Resolves the caller's membership once and attaches it to the request, so
 * services downstream read the role from `req.workspace` instead of trusting a
 * workspace id supplied by the client.
 */
@Injectable()
export class WorkspaceMemberGuard implements CanActivate {
  constructor(
    private readonly members: WorkspaceMembersService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    // Express 5 types route params as `string | string[]`; a repeated parameter
    // is a malformed request, not a list to iterate.
    const rawParam = request.params?.workspaceId;
    const workspaceId = typeof rawParam === 'string' ? rawParam : undefined;

    if (!request.user) {
      throw AppException.unauthorized('UNAUTHORIZED');
    }
    if (!workspaceId) {
      throw AppException.badRequest('WORKSPACE_CONTEXT_REQUIRED');
    }

    // Guards run before pipes, so `ParseUUIDPipe` on the handler has not fired
    // yet. Without this check a malformed id reaches PostgreSQL as a uuid
    // comparison and surfaces as a 500 instead of a 400.
    if (!UUID_PATTERN.test(workspaceId)) {
      throw AppException.badRequest('BAD_REQUEST', 'Invalid workspace identifier.');
    }

    const membership = await this.members.requireMembership(workspaceId, request.user.id);

    const requiredRole = this.reflector.getAllAndOverride<WorkspaceRole | undefined>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (requiredRole && !hasAtLeastRole(membership.role, requiredRole)) {
      throw AppException.forbidden('INSUFFICIENT_WORKSPACE_ROLE', undefined, {
        required: requiredRole,
        actual: membership.role,
      });
    }

    request.workspace = {
      workspaceId,
      membershipId: membership.id,
      role: membership.role,
    };

    return true;
  }
}
