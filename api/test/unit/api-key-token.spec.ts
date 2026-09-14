import { API_KEY_DISPLAY_CHARS, API_KEY_PREFIX } from '@coretask/contracts';

import {
  displayPrefix,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  readApiKeyHeader,
} from '../../src/modules/api-keys/lib/api-key-token';

describe('API key tokens', () => {
  it('generates a prefixed, URL-safe key with fresh entropy each time', () => {
    const first = generateApiKey();
    const second = generateApiKey();

    expect(first.startsWith(API_KEY_PREFIX)).toBe(true);
    // 32 bytes → 43 base64url characters, no padding.
    expect(first).toMatch(/^ctk_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toEqual(second);
  });

  it('hashes deterministically to SHA-256 hex, so the raw key never needs storing', () => {
    const key = generateApiKey();

    expect(hashApiKey(key)).toEqual(hashApiKey(key));
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey(key)).not.toEqual(hashApiKey(`${key}x`));
  });

  it('shows only the prefix and a few characters in the list', () => {
    const key = generateApiKey();
    const shown = displayPrefix(key);

    expect(shown).toHaveLength(API_KEY_PREFIX.length + API_KEY_DISPLAY_CHARS);
    expect(key.startsWith(shown)).toBe(true);
    // What is shown must never be enough to authenticate.
    expect(shown.length).toBeLessThan(key.length / 2);
  });

  describe('reading the key from a request', () => {
    const key = generateApiKey();

    it('prefers the dedicated header', () => {
      expect(readApiKeyHeader({ 'x-api-key': key })).toEqual(key);
      expect(readApiKeyHeader({ 'x-api-key': `  ${key}  ` })).toEqual(key);
    });

    it('accepts the bearer form only when the token is recognisably a key', () => {
      expect(readApiKeyHeader({ authorization: `Bearer ${key}` })).toEqual(key);
      expect(readApiKeyHeader({ authorization: `bearer ${key}` })).toEqual(key);
      // A JWT stays on the JWT path.
      expect(readApiKeyHeader({ authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.x.y' })).toBeNull();
    });

    it('returns null when nothing is sent, so the session path runs', () => {
      expect(readApiKeyHeader({})).toBeNull();
      expect(readApiKeyHeader({ 'x-api-key': '' })).toBeNull();
      expect(readApiKeyHeader({ authorization: 'Basic abc' })).toBeNull();
    });

    it('recognises the prefix on its own', () => {
      expect(looksLikeApiKey(key)).toBe(true);
      expect(looksLikeApiKey('eyJhbGciOi')).toBe(false);
    });
  });
});
