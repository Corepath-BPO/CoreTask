import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import {
  TOTP_DIGITS,
  TOTP_ISSUER,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW,
  TWO_FACTOR_RECOVERY_CODE_COUNT,
} from '@coretask/contracts';

/**
 * Time-based one-time passwords (RFC 6238 over RFC 4226), as every
 * authenticator app implements them: HMAC-SHA1, 30-second steps, six digits.
 *
 * Small enough to own outright, and owning it keeps the one property that
 * matters in view: `verifyTotp` reports *which* step matched, so the caller
 * can refuse a code it has already accepted.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 160 bits, the size RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Not a base32 string.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** The step a moment falls in: the counter RFC 6238 feeds to HOTP. */
export function totpStep(now = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

/** RFC 4226's dynamic truncation, zero-padded to six digits. */
export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
}

/**
 * The step `code` is valid for, within one step of now either way, or null.
 * Every candidate is compared, in constant time, so the answer's timing does
 * not say which step was close.
 */
export function verifyTotp(secretBase32: string, code: string, now = Date.now()): number | null {
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpStep(now);
  let matched: number | null = null;
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = current + delta;
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && matched === null) matched = step;
  }
  return matched;
}

/** What an authenticator app reads from the QR code. */
export function otpauthUrl(secretBase32: string, accountName: string): string {
  const label = encodeURIComponent(`${TOTP_ISSUER}:${accountName}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer: TOTP_ISSUER,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Recovery codes: 16 characters from an alphabet without 0/o, 1/l/i, grouped
 * in fours. 31 symbols × 16 is about 79 bits each, so a fast hash is enough
 * at rest.
 */
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generateRecoveryCodes(count = TWO_FACTOR_RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const characters = Array.from(
      { length: 16 },
      () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
    ).join('');
    return characters.match(/.{4}/g)!.join('-');
  });
}

/** Case, spaces and dashes do not matter when a code is typed back. */
export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toLowerCase();
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');
}
