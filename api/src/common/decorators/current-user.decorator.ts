import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthenticatedUser, RequestWithUser } from '../types/api.types';

/**
 * Injects the authenticated principal, or one of its fields:
 *
 *   `@CurrentUser() user: AuthenticatedUser`
 *   `@CurrentUser('id') userId: string`
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    return field ? request.user?.[field] : request.user;
  },
);
