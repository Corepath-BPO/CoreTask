import { createHmac, timingSafeEqual } from 'node:crypto';

import { WEBHOOK_SIGNATURE_TOLERANCE_SECONDS } from '@coretask/contracts';

/**
 * `t=<unix seconds>,v1=<hex>` where v1 = HMAC-SHA256(secret, "<t>.<body>").
 *
 * The timestamp is inside the signed string, so a captured delivery cannot be
 * replayed later: a receiver checking the tolerance rejects it even though the
 * signature itself is valid.
 */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

/** What a receiver does — kept here so the unit test and the docs agree with the signer. */
export function verifyWebhookSignature(
  secret: string,
  header: string,
  body: string,
  options: { now?: number; toleranceSeconds?: number } = {},
): boolean {
  const parts = new Map(
    header.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')] as const;
    }),
  );
  const timestamp = Number(parts.get('t'));
  const provided = parts.get('v1');

  if (!Number.isInteger(timestamp) || !provided) return false;

  const now = options.now ?? Math.floor(Date.now() / 1000);
  const tolerance = options.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
  if (Math.abs(now - timestamp) > tolerance) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
