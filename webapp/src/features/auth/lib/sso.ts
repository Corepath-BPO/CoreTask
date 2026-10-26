import { ERROR_CODE_MESSAGES, type ErrorCode, type SocialSsoProvider } from '@coretask/contracts';
import { emailSchema } from '@coretask/validation';

export const SOCIAL_PROVIDER_LABELS: Record<SocialSsoProvider, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
};

/** What an `?ssoError=` code says; a code this build does not know reads as a plain failure. */
export function ssoErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null;
  return code in ERROR_CODE_MESSAGES
    ? ERROR_CODE_MESSAGES[code as ErrorCode]
    : ERROR_CODE_MESSAGES.SSO_FAILED;
}

/**
 * Where a workspace's own identity provider is found: by a work address
 * (its domain, once the workspace has verified it) or by the workspace's
 * address, `/w/<slug>`, for people whose domain is not verified. Null for
 * something that is neither.
 */
export function workspaceTarget(input: string): { email: string } | { workspace: string } | null {
  const value = input.trim();
  if (!value) return null;
  if (value.includes('@')) {
    const email = emailSchema.safeParse(value);
    return email.success ? { email: email.data } : null;
  }
  // A pasted workspace link works as well as its slug.
  const slug = value
    .replace(/^.*\/w\//, '')
    .replace(/[/?#].*$/, '')
    .toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(slug) ? { workspace: slug } : null;
}

/**
 * The two-step challenge the API put in the fragment of `/sso/complete`
 * (the fragment, so it reached neither a server log nor a Referer).
 */
export function challengeFrom(hash: string): string | null {
  const challenge = new URLSearchParams(hash.replace(/^#/, '')).get('challenge');
  return challenge && challenge.length <= 2_000 ? challenge : null;
}
