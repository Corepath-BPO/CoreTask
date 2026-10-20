import type { AuthUser, ReauthPayload } from '@coretask/types';

import { ApiError } from '@/lib/api/api-error';

/** The payload `ReauthField`'s value stands for, for this account. */
export function reauthPayload(
  user: Pick<AuthUser, 'hasPassword' | 'twoFactorEnabled'>,
  value: string,
): ReauthPayload {
  if (user.hasPassword) return { password: value };
  if (user.twoFactorEnabled) return { code: value.trim() };
  return {};
}

/** Whether the field has what the server will ask for. */
export function reauthReady(
  user: Pick<AuthUser, 'hasPassword' | 'twoFactorEnabled'>,
  value: string,
): boolean {
  return !(user.hasPassword || user.twoFactorEnabled) || value.trim().length > 0;
}

/** The error codes that belong beside the field rather than above the form. */
const REAUTH_ERROR_CODES = new Set([
  'REAUTH_REQUIRED',
  'CURRENT_PASSWORD_INCORRECT',
  'TWO_FACTOR_CODE_INVALID',
  'RECENT_SIGN_IN_REQUIRED',
]);

export function reauthErrorOf(error: unknown): string | undefined {
  return error instanceof ApiError && REAUTH_ERROR_CODES.has(error.code)
    ? error.message
    : undefined;
}
