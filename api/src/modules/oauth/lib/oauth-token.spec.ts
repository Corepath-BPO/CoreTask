import { createHash } from 'node:crypto';

import {
  generateToken,
  hashToken,
  readBasicClient,
  readOAuthBearer,
  sameHash,
  secretHint,
  verifierMatches,
} from './oauth-token';

describe('OAuth token helpers', () => {
  it('makes prefixed random tokens and stores only their hash', () => {
    const token = generateToken('cto_');
    expect(token).toMatch(/^cto_[A-Za-z0-9_-]{43}$/);
    expect(generateToken('cto_')).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(sameHash(hashToken(token), hashToken(token))).toBe(true);
    expect(sameHash(hashToken(token), hashToken('other'))).toBe(false);
    expect(secretHint('cts_abcdefghijk')).toBe('cts_abcdef');
  });

  it('reads only access tokens from the bearer header', () => {
    expect(readOAuthBearer({ authorization: 'Bearer cto_abc' })).toBe('cto_abc');
    expect(readOAuthBearer({ authorization: 'Bearer ctk_abc' })).toBeNull();
    expect(readOAuthBearer({ authorization: 'Bearer eyJhbGciOi' })).toBeNull();
    expect(readOAuthBearer({})).toBeNull();
  });

  it('reads form-encoded client credentials from HTTP Basic', () => {
    const header = `Basic ${Buffer.from('ctc_id:cts_a%3Ab').toString('base64')}`;
    expect(readBasicClient({ authorization: header })).toEqual({
      clientId: 'ctc_id',
      clientSecret: 'cts_a:b',
    });
    expect(readBasicClient({ authorization: 'Bearer x' })).toBeNull();
    expect(
      readBasicClient({ authorization: `Basic ${Buffer.from('nocolon').toString('base64')}` }),
    ).toBeNull();
  });

  it('checks a PKCE verifier against its S256 challenge', () => {
    const verifier = 'a'.repeat(43);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifierMatches(verifier, challenge)).toBe(true);
    expect(verifierMatches('b'.repeat(43), challenge)).toBe(false);
    // Too short to be a verifier at all.
    expect(verifierMatches('short', challenge)).toBe(false);
  });
});
