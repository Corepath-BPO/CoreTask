import { signWebhook, verifyWebhookSignature } from '../../src/modules/webhooks/lib/signature';

describe('webhook signatures', () => {
  const secret = 'whsec_test_secret_with_enough_entropy';
  const body = JSON.stringify({ id: 'evt', type: 'task.completed' });
  const now = 1_800_000_000;

  it('signs as t=<ts>,v1=<hex> and verifies with the same secret and body', () => {
    const header = signWebhook(secret, now, body);

    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(secret, header, body, { now })).toBe(true);
  });

  it('rejects a different secret or a changed body', () => {
    const header = signWebhook(secret, now, body);

    expect(verifyWebhookSignature('whsec_other', header, body, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, header, `${body} `, { now })).toBe(false);
  });

  /** The timestamp is inside the signed string, so a captured delivery cannot be replayed later. */
  it('rejects a signature outside the tolerance window', () => {
    const header = signWebhook(secret, now, body);

    expect(verifyWebhookSignature(secret, header, body, { now: now + 299 })).toBe(true);
    expect(verifyWebhookSignature(secret, header, body, { now: now + 301 })).toBe(false);
    expect(verifyWebhookSignature(secret, header, body, { now, toleranceSeconds: 0 })).toBe(true);
  });

  it('rejects malformed headers without throwing', () => {
    expect(verifyWebhookSignature(secret, '', body, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, 't=abc,v1=00', body, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, `t=${now}`, body, { now })).toBe(false);
    expect(verifyWebhookSignature(secret, `t=${now},v1=deadbeef`, body, { now })).toBe(false);
  });
});
