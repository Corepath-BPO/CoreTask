import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * A short claim CoreTask signs and later reads back: `<payload>.<mac>`, both
 * base64url, the payload JSON with an expiry and a purpose. For the install
 * `state` and the account-link button — values that leave CoreTask through
 * Slack and come back through a browser, where nothing must be able to
 * change what they say. Not secret: whoever holds one can read it.
 */
interface Envelope<T> {
  p: string;
  exp: number;
  n: string;
  d: T;
}

export function sealToken<T>(
  key: Buffer,
  purpose: string,
  data: T,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const envelope: Envelope<T> = {
    p: purpose,
    exp: Math.floor(now / 1000) + ttlSeconds,
    n: randomBytes(8).toString('base64url'),
    d: data,
  };
  const payload = Buffer.from(JSON.stringify(envelope)).toString('base64url');
  return `${payload}.${mac(key, payload)}`;
}

/** The data, or null when the token is malformed, forged, expired or for something else. */
export function openToken<T>(
  key: Buffer,
  purpose: string,
  token: string,
  now = Date.now(),
): T | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;

  const expected = Buffer.from(mac(key, payload));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null;

  try {
    const envelope = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Envelope<T>;
    if (envelope.p !== purpose) return null;
    if (!Number.isFinite(envelope.exp) || envelope.exp < Math.floor(now / 1000)) return null;
    return envelope.d;
  } catch {
    return null;
  }
}

function mac(key: Buffer, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}
