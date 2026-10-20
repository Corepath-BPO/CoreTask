import { createHash, randomBytes } from 'node:crypto';

import type { SocialSsoProvider } from '@coretask/contracts';

/** Personal Microsoft accounts (Outlook.com, Hotmail, Xbox) all sign in from this one tenant. */
export const MICROSOFT_CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** How far apart CoreTask's clock and the provider's may be. */
const CLOCK_SKEW_SECONDS = 120;
const NAME_MAX_LENGTH = 120;
const EMAIL_MAX_LENGTH = 254;
const TENANT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An ID token that is not one CoreTask asked for. `message` is for the log, never the person. */
export class IdTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdTokenError';
  }
}

/** What an ID token says about the person, once it has been checked. */
export interface VerifiedIdentity {
  /** Google's `sub`; Microsoft's `<tid>:<oid>`. Stable for the person, whatever their address. */
  subject: string;
  /** Lower-cased. */
  email: string;
  /** Whether the provider vouches that the address is theirs, so it may stand for a CoreTask account. */
  emailTrusted: boolean;
  name: string | null;
}

export type IdTokenExpectations =
  | { provider: 'google'; clientId: string; nonce: string; issuer: string }
  | {
      provider: 'microsoft';
      clientId: string;
      nonce: string;
      /** `https://login.microsoftonline.com`, without the tenant. */
      loginUrl: string;
      /** `common`, `organizations`, `consumers`, or one tenant's id. */
      tenant: string;
    };

/** RFC 7636: a random verifier kept in the browser's cookie, and its SHA-256 sent ahead. */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The claims of a compact JWT. The signature is not looked at here; see `OidcService.complete`. */
export function decodeIdToken(token: unknown): Record<string, unknown> {
  if (typeof token !== 'string') throw new IdTokenError('The token response had no id_token.');
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) throw new IdTokenError('The id_token is not a JWT.');
  try {
    const claims: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!claims || typeof claims !== 'object' || Array.isArray(claims))
      throw new Error('not an object');
    return claims as Record<string, unknown>;
  } catch {
    throw new IdTokenError('The id_token payload is not JSON.');
  }
}

/**
 * OpenID Connect Core 3.1.3.7, everything but the signature: who issued it,
 * who it is for, when, and that it answers the request this browser started
 * (the nonce). Then the provider's own rules for who the person is and
 * whether their address can be trusted.
 */
export function validateIdTokenClaims(
  claims: Record<string, unknown>,
  expected: IdTokenExpectations,
  now = Date.now(),
): VerifiedIdentity {
  const nowSeconds = Math.floor(now / 1000);

  checkAudience(claims, expected.clientId);

  const exp = claims['exp'];
  if (typeof exp !== 'number' || exp + CLOCK_SKEW_SECONDS <= nowSeconds) {
    throw new IdTokenError('The id_token has expired.');
  }
  const iat = claims['iat'];
  if (typeof iat !== 'number' || iat - CLOCK_SKEW_SECONDS > nowSeconds) {
    throw new IdTokenError('The id_token was issued in the future.');
  }
  if (typeof claims['nonce'] !== 'string' || claims['nonce'] !== expected.nonce) {
    throw new IdTokenError('The id_token answers a different sign-in (nonce).');
  }

  const email = readEmail(claims['email']);
  const name = readName(claims);

  if (expected.provider === 'google') {
    // Google documents both spellings of its issuer, and uses both.
    const iss = claims['iss'];
    const bare = expected.issuer.replace(/^https:\/\//, '');
    if (iss !== expected.issuer && iss !== bare) {
      throw new IdTokenError(`Unexpected issuer: ${String(iss)}`);
    }
    const sub = claims['sub'];
    if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255) {
      throw new IdTokenError('The id_token has no subject.');
    }
    return { subject: sub, email, emailTrusted: claims['email_verified'] === true, name };
  }

  // Microsoft: one issuer per tenant, so the tenant is read from the token
  // and the issuer must be the one that tenant signs as.
  const tid = claims['tid'];
  if (typeof tid !== 'string' || !TENANT_ID.test(tid)) {
    throw new IdTokenError('The id_token has no tenant.');
  }
  if (claims['iss'] !== `${expected.loginUrl}/${tid}/v2.0`) {
    throw new IdTokenError(`Unexpected issuer: ${String(claims['iss'])}`);
  }
  checkTenant(tid, expected.tenant);
  const oid = claims['oid'];
  if (typeof oid !== 'string' || oid.length === 0 || oid.length > 100) {
    throw new IdTokenError('The id_token has no object id.');
  }

  return {
    // `sub` is pairwise per app; `oid` is the person in their tenant, and
    // with the tenant it is unique across all of Microsoft.
    subject: `${tid.toLowerCase()}:${oid}`,
    email,
    // A work account's `email` is whatever an admin typed, unless the tenant
    // has proved the domain — which is what `xms_edov` says. A personal
    // account's address is Microsoft's own, and always checked.
    emailTrusted: claims['xms_edov'] === true || tid.toLowerCase() === MICROSOFT_CONSUMER_TENANT,
    name,
  };
}

/** The provider name as a path segment, or null for anything else. */
export function parseSocialProvider(value: unknown): SocialSsoProvider | null {
  return value === 'google' || value === 'microsoft' ? value : null;
}

function checkAudience(claims: Record<string, unknown>, clientId: string): void {
  const aud = claims['aud'];
  if (typeof aud === 'string') {
    if (aud !== clientId) throw new IdTokenError('The id_token is for another app.');
    return;
  }
  if (Array.isArray(aud) && aud.includes(clientId)) {
    // Several audiences: the authorised party must be this app.
    if (aud.length > 1 && claims['azp'] !== clientId) {
      throw new IdTokenError('The id_token was issued to another app (azp).');
    }
    return;
  }
  throw new IdTokenError('The id_token is for another app.');
}

/** The app may be registered for one tenant, work accounts only, or personal accounts only. */
function checkTenant(tid: string, tenant: string): void {
  const id = tid.toLowerCase();
  const configured = tenant.toLowerCase();
  if (configured === 'common') return;
  if (configured === 'consumers' && id === MICROSOFT_CONSUMER_TENANT) return;
  if (configured === 'organizations' && id !== MICROSOFT_CONSUMER_TENANT) return;
  if (configured === id) return;
  throw new IdTokenError(`The account's tenant ${tid} is not allowed by MICROSOFT_SSO_TENANT.`);
}

function readEmail(value: unknown): string {
  if (typeof value !== 'string') throw new IdTokenError('The id_token has no email claim.');
  const email = value.trim().toLowerCase();
  if (email.length > EMAIL_MAX_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new IdTokenError('The id_token email is not an address.');
  }
  return email;
}

function readName(claims: Record<string, unknown>): string | null {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const name =
    text(claims['name']) ||
    [text(claims['given_name']), text(claims['family_name'])].filter(Boolean).join(' ');
  return name ? name.slice(0, NAME_MAX_LENGTH) : null;
}
