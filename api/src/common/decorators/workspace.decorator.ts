import type { WorkspaceRole } from '@coretask/contracts';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

import type { RequestWithUser, WorkspaceContext } from '../types/api.types';

export const WORKSPACE_ROLES_KEY = 'coretask:workspaceRoles';

/**
 * Requires the caller's role in the target workspace to be at least `role`.
 * Enforced by `WorkspaceMemberGuard`.
 */
export const RequireWorkspaceRole = (role: WorkspaceRole) => SetMetadata(WORKSPACE_ROLES_KEY, role);

/** Injects the membership resolved by `WorkspaceMemberGuard` for this request. */
export const CurrentWorkspace = createParamDecorator(
  (field: keyof WorkspaceContext | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return field ? request.workspace?.[field] : request.workspace;
  },
);
