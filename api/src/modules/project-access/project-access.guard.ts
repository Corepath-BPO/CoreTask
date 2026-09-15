import { hasAtLeastRole, type WorkspaceRole } from '@coretask/contracts';
import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  PROJECT_ADMIN_KEY,
  WORKSPACE_ROLES_KEY,
} from '../../common/decorators/workspace.decorator';
import { AppException } from '../../common/exceptions/app.exception';
import type { RequestWithUser } from '../../common/types/api.types';
import { UUID_PATTERN } from '../../common/utils/uuid.util';

import { ProjectAccessService } from './project-access.service';

/**
 * Enforces project privacy for any route carrying a `:projectId` parameter.
 *
 * Must run after `WorkspaceMemberGuard` — `@UseGuards(WorkspaceMemberGuard,
 * ProjectAccessGuard)` — because it reads the membership that guard attached.
 * It then does two things:
 *
 * 1. Resolves the caller's standing in the project (404 when the project does
 *    not exist here or is private and the caller is neither a member nor a
 *    workspace admin — an invisible project must look like a missing one).
 * 2. Lowers `request.workspace.role` to the *effective* role. Every role check
 *    downstream — `@RequireWorkspaceRole`, `hasAtLeastRole(role, …)` on the
 *    injected role — then honours the project's cap without knowing about it.
 */
@Injectable()
export class ProjectAccessGuard implements CanActivate {
  constructor(
    private readonly access: ProjectAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const workspace = request.workspace;

    if (!request.user) {
      throw AppException.unauthorized('UNAUTHORIZED');
    }
    // Refuse rather than trust: without the workspace guard's result there is
    // no role to lower and no tenant to scope the lookup to.
    if (!workspace) {
      throw AppException.badRequest('WORKSPACE_CONTEXT_REQUIRED');
    }

    const rawParam = request.params?.projectId;
    const projectId = typeof rawParam === 'string' ? rawParam : undefined;

    if (!projectId) {
      throw AppException.badRequest('BAD_REQUEST', 'A project identifier is required.');
    }
    if (!UUID_PATTERN.test(projectId)) {
      throw AppException.badRequest('BAD_REQUEST', 'Invalid project identifier.');
    }

    const { project: _project, ...access } = await this.access.resolveAccess(
      workspace.workspaceId,
      projectId,
      { userId: request.user.id, role: workspace.role },
    );

    request.project = access;
    workspace.role = access.effectiveRole;

    // `WorkspaceMemberGuard` checked this against the raw role; the effective
    // role is never higher, so a second failure here is the project's doing.
    const requiredRole = this.reflector.getAllAndOverride<WorkspaceRole | undefined>(
      WORKSPACE_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredRole && !hasAtLeastRole(access.effectiveRole, requiredRole)) {
      throw AppException.forbidden('INSUFFICIENT_PROJECT_ROLE', undefined, {
        required: requiredRole,
        actual: access.effectiveRole,
      });
    }

    const needsAdmin = this.reflector.getAllAndOverride<boolean | undefined>(PROJECT_ADMIN_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (needsAdmin && !access.canManage) {
      throw AppException.forbidden(
        'INSUFFICIENT_PROJECT_ROLE',
        'Only a project admin can change who is in this project.',
      );
    }

    return true;
  }
}
