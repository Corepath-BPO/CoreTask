import { REFRESH_TOKEN_COOKIE } from '@coretask/contracts';
import type { AuthSession, TwoFactorChallenge } from '@coretask/types';
import type { Request, Response } from 'express';

import { buildRefreshCookieOptions } from '../../../common/utils/cookie.util';
import type { AppConfigService } from '../../../config/app-config.service';
import type { AuthResult } from '../auth.service';
import type { SessionContext } from '../token.service';

/** Where the request came from, recorded on the session for the session list. */
export function sessionContext(request: Request): SessionContext {
  const context: SessionContext = {};
  const userAgent = request.headers['user-agent'];

  if (typeof userAgent === 'string') context.userAgent = userAgent;
  if (request.ip) context.ipAddress = request.ip;

  return context;
}

export function readRefreshCookie(request: Request): string | undefined {
  const value = request.cookies?.[REFRESH_TOKEN_COOKIE];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Sets the rotated refresh cookie and returns only the body-safe half. */
export function completeSession(
  result: AuthResult,
  response: Response,
  config: AppConfigService,
): AuthSession {
  response.cookie(
    REFRESH_TOKEN_COOKIE,
    result.refreshToken,
    buildRefreshCookieOptions(config, result.refreshExpiresInMs),
  );

  return result.session;
}

export function isTwoFactorChallenge(
  value: AuthResult | TwoFactorChallenge,
): value is TwoFactorChallenge {
  return 'twoFactorRequired' in value;
}
