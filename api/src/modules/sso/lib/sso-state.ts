import { API_PREFIX, SSO_STATE_TTL_SECONDS, type SocialSsoProvider } from '@coretask/contracts';
import type { CookieOptions } from 'express';

import type { AppConfigService } from '../../../config/app-config.service';
import { decryptSecret, encryptSecret } from '../../webhooks/lib/secret-cipher';

/**
 * The cookie that carries a sign-in across the round trip to the provider.
 * Scoped to the SSO routes, so no other request ever carries it.
 */
export const SSO_COOKIE = 'coretask_sso';
export const SSO_COOKIE_PATH = `${API_PREFIX}/auth/sso`;

/** Signing in, or connecting a provider to the account that is signed in. */
export type SsoMode = 'login' | 'link';

interface SsoFlow {
  mode: SsoMode;
  /** For `link`: the account to connect it to. */
  userId?: string;
  /** A path on the web app, already sanitised. */
  redirect: string;
}

export interface OidcState extends SsoFlow {
  kind: 'oidc';
  provider: SocialSsoProvider;
  state: string;
  nonce: string;
  codeVerifier: string;
}

export interface SamlState extends SsoFlow {
  kind: 'saml';
  connectionId: string;
  /** Sent as RelayState and matched when the response comes back. */
  relayState: string;
}

export type SsoState = OidcState | SamlState;

/**
 * Encrypted rather than signed: the PKCE verifier and the nonce must stay
 * secret until the provider has answered, and the expiry inside is what
 * counts — the cookie's own max-age is only the browser's promise.
 */
export function sealSsoState(key: Buffer, state: SsoState, now = Date.now()): string {
  return encryptSecret(JSON.stringify({ ...state, exp: now + SSO_STATE_TTL_SECONDS * 1_000 }), key);
}

/** The state, or null when there is none, it was tampered with, or it ran out. */
export function openSsoState(key: Buffer, value: unknown, now = Date.now()): SsoState | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_000) return null;
  try {
    const parsed = JSON.parse(decryptSecret(value, key)) as SsoState & { exp?: unknown };
    if (typeof parsed.exp !== 'number' || parsed.exp <= now) return null;
    if (parsed.kind !== 'oidc' && parsed.kind !== 'saml') return null;
    const { exp: _exp, ...state } = parsed;
    return state as SsoState;
  } catch {
    return null;
  }
}

/**
 * Lax, whatever the refresh cookie uses: the provider sends the browser back
 * with a top-level GET, which Lax allows, and nothing else needs it.
 */
export function ssoCookieOptions(config: AppConfigService): CookieOptions {
  return { ...ssoClearCookieOptions(config), maxAge: SSO_STATE_TTL_SECONDS * 1_000 };
}

/** Must match `ssoCookieOptions` but for the age, or the browser keeps the cookie. */
export function ssoClearCookieOptions(config: AppConfigService): CookieOptions {
  return {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: 'lax',
    path: SSO_COOKIE_PATH,
  };
}
