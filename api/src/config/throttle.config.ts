import { getEnv } from './env';

/**
 * Route-level throttle overrides.
 *
 * Decorator arguments are evaluated when the class is defined, before Nest's DI
 * container exists, so these read the validated environment directly instead of
 * going through `AppConfigService`.
 */
const env = getEnv();

/** Tighter ceiling for credential endpoints: login, register, refresh. */
export const AUTH_THROTTLE = {
  default: {
    limit: env.AUTH_RATE_LIMIT_MAX,
    ttl: env.RATE_LIMIT_TTL * 1_000,
  },
} as const;
