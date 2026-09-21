import { WEBHOOK_SECRET_PREFIX } from '@coretask/contracts';

import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateWebhookSecret,
} from '../../src/modules/webhooks/lib/secret-cipher';

describe('webhook secret cipher', () => {
  const key = deriveKey('dev_only_key_material');

  it('derives a stable 32-byte key from the configured material', () => {
    expect(key).toHaveLength(32);
    expect(deriveKey('dev_only_key_material')).toEqual(key);
    expect(deriveKey('something else')).not.toEqual(key);
  });

  it('round-trips a secret and never writes the same ciphertext twice', () => {
    const secret = generateWebhookSecret();
    const first = encryptSecret(secret, key);
    const second = encryptSecret(secret, key);

    expect(first).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(first).not.toEqual(second);
    expect(decryptSecret(first, key)).toEqual(secret);
    expect(decryptSecret(second, key)).toEqual(secret);
  });

  it('refuses tampered ciphertext and the wrong key', () => {
    const stored = encryptSecret('whsec_keep_me_safe_please', key);
    const [version, iv, tag, ciphertext] = stored.split('.') as [string, string, string, string];
    const flipped = ciphertext[0] === 'A' ? 'B' : 'A';

    expect(() =>
      decryptSecret([version, iv, tag, flipped + ciphertext.slice(1)].join('.'), key),
    ).toThrow();
    expect(() => decryptSecret(stored, deriveKey('another key'))).toThrow();
    expect(() => decryptSecret('v2.x.y.z', key)).toThrow(/Unrecognised/);
  });

  it('generates recognisable, high-entropy secrets', () => {
    const secret = generateWebhookSecret();

    expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(generateWebhookSecret()).not.toEqual(secret);
  });
});
