import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_SECRET_DISPLAY_CHARS,
  OAUTH_CLIENT_SECRET_PREFIX,
  OAUTH_TOKEN_BYTES,
} from '@coretask/contracts';

/** Pure helpers for the strings themselves, kept free of Nest so they unit-test cold. */

/** A prefix and 32 random bytes: a client id, a secret, a code or a token. */
export function generateToken(prefix = ''): string {
  return `${prefix}${randomBytes(OAUTH_TOKEN_BYTES).toString('base64url')}`;
}

/**
 * SHA-256, as for API keys: every one of these carries 256 bits of entropy, so
 * a slow KDF would add cost without adding safety. Stored hashed so a database
 * leak cannot be replayed.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** What the app list shows so a developer can tell secrets apart. */
export function secretHint(secret: string): string {
  return secret.slice(0, OAUTH_CLIENT_SECRET_PREFIX.length + OAUTH_SECRET_DISPLAY_CHARS);
}

/** Two hex hashes, compared in constant time. */
export function sameHash(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** PKCE S256: base64url(SHA-256(verifier)) must equal the challenge sent at authorization. */
export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * An OAuth access token from `Authorization: Bearer cto_…`, or null.
 *
 * The prefix keeps the three bearer credentials apart without a lookup: a JWT
 * starts with `eyJ`, an API key with `ctk_`, an access token with `cto_`.
 */
export function readOAuthBearer(headers: IncomingHttpHeaders): string | null {
  const header = headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  return token && token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX) ? token : null;
}

/** `client_secret_basic`: the client id and secret in an HTTP Basic header. */
export function readBasicClient(
  headers: IncomingHttpHeaders,
): { clientId: string; clientSecret: string } | null {
  const header = headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Basic\s+(\S+)$/i.exec(header.trim());
  if (!match?.[1]) return null;
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon <= 0) return null;
  // Form-encoded per RFC 6749 §2.3.1, so a secret holding ':' or '%' survives.
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part.replace(/\+/g, ' '));
    } catch {
      return part;
    }
  };
  return {
    clientId: decode(decoded.slice(0, colon)),
    clientSecret: decode(decoded.slice(colon + 1)),
  };
}
