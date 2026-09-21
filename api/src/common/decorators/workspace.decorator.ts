import type { WorkspaceRole } from '@coretask/contracts';
import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';

import type {
  ActorContext,
  ProjectAccessContext,
  RequestWithUser,
  WorkspaceContext,
} from '../types/api.types';

export const WORKSPACE_ROLES_KEY = 'coretask:workspaceRoles';
export const PROJECT_ADMIN_KEY = 'coretask:projectAdmin';

/**
 * Requires the caller's role in the target workspace to be at least `role`.
 * Enforced by `WorkspaceMemberGuard`, and again by `ProjectAccessGuard`
 * against the effective role on routes under a project.
 */
export const RequireWorkspaceRole = (role: WorkspaceRole) => SetMetadata(WORKSPACE_ROLES_KEY, role);

/**
 * Requires the caller to be a project ADMIN — or a workspace OWNER/ADMIN, who
 * manage every project. Only meaningful on a route `ProjectAccessGuard` runs on.
 */
export const RequireProjectAdmin = () => SetMetadata(PROJECT_ADMIN_KEY, true);

/** Injects the membership resolved by `WorkspaceMemberGuard` for this request. */
export const CurrentWorkspace = createParamDecorator(
  (field: keyof WorkspaceContext | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return field ? request.workspace?.[field] : request.workspace;
  },
);

/** Injects the project standing resolved by `ProjectAccessGuard` for this request. */
export const CurrentProject = createParamDecorator(
  (field: keyof ProjectAccessContext | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return field ? request.project?.[field] : request.project;
  },
);

/**
 * Who is acting, with the role they act with on this route: the workspace
 * role, lowered by `ProjectAccessGuard` when the route is under a project.
 */
export const Actor = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<RequestWithUser>();
  const actor: ActorContext = {
    userId: request.user.id,
    role: request.workspace?.role as WorkspaceRole,
  };
  return actor;
});
