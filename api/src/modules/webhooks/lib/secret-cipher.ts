import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { WEBHOOK_SECRET_PREFIX } from '@coretask/contracts';

/**
 * Signing secrets at rest.
 *
 * A hash would not do — signing needs the secret back — so it is encrypted with
 * AES-256-GCM under a key derived from `WEBHOOK_SECRET_ENCRYPTION_KEY`. The
 * `v1.` prefix leaves room to rotate the scheme without guessing which one a
 * row was written with.
 */
const VERSION = 'v1';

export function deriveKey(material: string): Buffer {
  return createHash('sha256').update(material).digest();
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
}

export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, ciphertext] = stored.split('.');

  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Unrecognised stored secret format.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** `whsec_` + 32 random bytes — recognisable, like the API keys. */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}
