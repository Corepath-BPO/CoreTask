import { createHmac, timingSafeEqual } from 'node:crypto';

import { SLACK_REQUEST_TOLERANCE_SECONDS } from '@coretask/contracts';

/**
 * Slack's request signing: `v0=` + HMAC-SHA256(signing secret,
 * `v0:<timestamp>:<raw body>`), in `X-Slack-Signature`, with the timestamp in
 * `X-Slack-Request-Timestamp`. Over the bytes as sent — a body parsed and
 * re-encoded would not match — so the app keeps the raw body for this.
 */
export function signSlackRequest(secret: string, timestamp: number, body: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

export function verifySlackRequest(
  secret: string,
  input: { timestamp: string | undefined; signature: string | undefined; body: string },
  now = Math.floor(Date.now() / 1000),
): boolean {
  const timestamp = Number(input.timestamp);
  if (!Number.isInteger(timestamp) || !input.signature) return false;
  // A captured request replayed later is refused even though it is signed.
  if (Math.abs(now - timestamp) > SLACK_REQUEST_TOLERANCE_SECONDS) return false;

  const expected = Buffer.from(signSlackRequest(secret, timestamp, input.body), 'utf8');
  const provided = Buffer.from(input.signature, 'utf8');
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}
