import { createHash, randomBytes } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

import {
  API_KEY_DISPLAY_CHARS,
  API_KEY_HEADER,
  API_KEY_PREFIX,
  API_KEY_TOKEN_BYTES,
} from '@coretask/contracts';

/** Pure helpers for the key string itself, kept free of Nest so they unit-test cold. */

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(API_KEY_TOKEN_BYTES).toString('base64url')}`;
}

/**
 * SHA-256 is right here, as it is for refresh tokens: the key already carries
 * 256 bits of entropy, so a slow KDF would add cost without adding safety. The
 * hash exists so a database leak cannot be replayed.
 */
export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** What the list shows so a person can tell keys apart: prefix plus a few characters. */
export function displayPrefix(raw: string): string {
  return raw.slice(0, API_KEY_PREFIX.length + API_KEY_DISPLAY_CHARS);
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX);
}

/**
 * Reads a key from `X-API-Key`, or from `Authorization: Bearer ctk_…`.
 *
 * The bearer form is accepted because many HTTP clients only know how to send
 * that header; the prefix keeps it unambiguous — a JWT starts with `eyJ`.
 * Returns null when the request carries no key, so the JWT path runs instead.
 */
export function readApiKeyHeader(headers: IncomingHttpHeaders): string | null {
  const direct = headers[API_KEY_HEADER];
  const value = Array.isArray(direct) ? direct[0] : direct;

  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }

  const authorization = headers.authorization;
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (match && looksLikeApiKey(match[1])) {
      return match[1];
    }
  }

  return null;
}
