import { getEnv } from './env';

/**
 * Route-level throttle overrides.
 *
 * Decorator arguments are evaluated when the class is defined, before Nest's DI
 * container exists, so these read the validated environment directly instead of
 * going through `AppConfigService`.
 */
const env = getEnv();

/**
 * Tighter ceiling for the endpoints that accept credentials: login and register.
 *
 * The point is to slow password guessing, so it only belongs where a password is
 * submitted.
 */
export const AUTH_THROTTLE = {
  default: {
    limit: env.AUTH_RATE_LIMIT_MAX,
    ttl: env.RATE_LIMIT_TTL * 1_000,
  },
} as const;

/**
 * Restores the ordinary API ceiling for session endpoints that take no
 * credentials.
 *
 * `/auth/refresh` and `/auth/logout` authenticate with an HTTP-only cookie an
 * attacker cannot read, and a replayed token already revokes its whole family —
 * so guess-rate limiting buys nothing there. It does actively hurt: every tab
 * refreshes on load, so a handful of tabs or reloads used to trip the limit and
 * sign the user out of a perfectly valid session.
 */
export const SESSION_THROTTLE = {
  default: {
    limit: env.RATE_LIMIT_MAX,
    ttl: env.RATE_LIMIT_TTL * 1_000,
  },
} as const;
