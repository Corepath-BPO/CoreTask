import { API_PREFIX } from '@coretask/contracts';
import type { CookieOptions } from 'express';

import type { AppConfigService } from '../../config/app-config.service';

/**
 * Scoping the refresh cookie to the auth routes means it is not attached to any
 * other API call, so a bug elsewhere cannot echo it back or log it.
 */
export const REFRESH_COOKIE_PATH = `${API_PREFIX}/auth`;

export function buildRefreshCookieOptions(
  config: AppConfigService,
  maxAgeMs: number,
): CookieOptions {
  const { domain, sameSite, secure } = config.cookie;

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeMs,
    ...(domain ? { domain } : {}),
  };
}

/** Must mirror `buildRefreshCookieOptions` exactly or the browser keeps the cookie. */
export function buildClearCookieOptions(config: AppConfigService): CookieOptions {
  const { domain, sameSite, secure } = config.cookie;

  return {
    httpOnly: true,
    secure,
    sameSite,
    path: REFRESH_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  };
}

/**
 * Parses a JWT-style duration (`15m`, `30d`, `3600`) into milliseconds.
 *
 * Kept local rather than pulling in `ms`, and shared by the token service and
 * cookie builder so the cookie can never outlive the token it carries.
 */
export function durationToMs(duration: string): number {
  const match = /^(\d+)\s*(ms|s|m|h|d|w)?$/i.exec(duration.trim());

  if (!match?.[1]) {
    throw new Error(`Unsupported duration format: "${duration}"`);
  }

  const value = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();

  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
  };

  return value * (multipliers[unit] ?? 1_000);
}
