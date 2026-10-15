import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { ApiKeyAuthService } from '../../modules/api-keys/api-key-auth.service';
import { readApiKeyHeader } from '../../modules/api-keys/lib/api-key-token';
import { readOAuthBearer } from '../../modules/oauth/lib/oauth-token';
import { OAuthTokenAuthService } from '../../modules/oauth/oauth-token-auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SESSION_ONLY_KEY } from '../decorators/session-only.decorator';
import { AppException } from '../exceptions/app.exception';
import type { AuthenticatedUser, RequestWithUser } from '../types/api.types';

/**
 * Registered globally as `APP_GUARD`, so authentication is the default and
 * anonymous access has to be requested with `@Public()`.
 *
 * Three credentials are accepted. A request carrying a workspace API key
 * (`X-API-Key`, or `Authorization: Bearer ctk_…`) is authenticated as that
 * key's service account; one carrying an OAuth access token (`Bearer cto_…`)
 * as the person who allowed the app; anything else goes through the Passport
 * JWT strategy. Which path runs is decided by the request, never by the route,
 * so every route that must stay with a signed-in person says so with
 * `@SessionOnly()` — and neither a key nor an app may call one.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeys: ApiKeyAuthService,
    private readonly oauthTokens: OAuthTokenAuthService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const rawKey = readApiKeyHeader(request.headers);

    if (rawKey !== null) {
      // Authenticate before deciding what the key may do, so a bad key is a
      // 401 whichever route it tried.
      request.user = await this.apiKeys.authenticate(rawKey);

      if (this.reflector.getAllAndOverride<boolean>(SESSION_ONLY_KEY, targets)) {
        throw AppException.forbidden('API_KEY_NOT_ALLOWED');
      }

      return true;
    }

    const oauthToken = readOAuthBearer(request.headers);

    if (oauthToken !== null) {
      request.user = await this.oauthTokens.authenticate(oauthToken);

      if (this.reflector.getAllAndOverride<boolean>(SESSION_ONLY_KEY, targets)) {
        throw AppException.forbidden('OAUTH_TOKEN_NOT_ALLOWED');
      }

      return true;
    }

    return super.canActivate(context) as Promise<boolean>;
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
