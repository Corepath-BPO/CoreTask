import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedUser } from '../types/api.types';

/**
 * Registered globally as `APP_GUARD`, so authentication is the default and
 * anonymous access has to be requested with `@Public()`.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return isPublic ? true : super.canActivate(context);
  }

  /**
   * Distinguishes an expired token from a malformed one: the web client silently
   * refreshes on `ACCESS_TOKEN_EXPIRED` but sends the user to /login otherwise.
   */
  override handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: unknown,
    info: unknown,
  ): TUser {
    if (err || !user) {
      const reason = info instanceof Error ? info.name : undefined;

      if (reason === 'TokenExpiredError') {
        throw AppException.unauthorized('ACCESS_TOKEN_EXPIRED');
      }
      if (reason === 'JsonWebTokenError') {
        throw AppException.unauthorized('ACCESS_TOKEN_INVALID');
      }
      throw AppException.unauthorized('UNAUTHORIZED');
    }

    return user as TUser;
  }
}
