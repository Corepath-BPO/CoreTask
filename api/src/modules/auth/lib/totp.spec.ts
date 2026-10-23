import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  otpauthUrl,
  totpStep,
  verifyTotp,
} from './totp';

/** RFC 6238 appendix B's SHA-1 key, "12345678901234567890", in base32. */
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 test vectors, cut to six digits', () => {
    // The RFC lists eight digits; an authenticator app shows the last six.
    const vectors: [number, string][] = [
      [59, '287082'],
      [1_111_111_109, '081804'],
      [1_111_111_111, '050471'],
      [1_234_567_890, '005924'],
      [2_000_000_000, '279037'],
    ];
    const secret = base32Decode(RFC_SECRET);
    for (const [seconds, code] of vectors) {
      expect(hotp(secret, totpStep(seconds * 1_000))).toBe(code);
    }
  });

  it('round-trips base32, ignoring spaces, dashes and case', () => {
    const bytes = Buffer.from('any carnal pleasure.');
    const encoded = base32Encode(bytes);
    expect(base32Decode(encoded)).toEqual(bytes);
    expect(base32Decode(encoded.toLowerCase().replace(/(.{4})/g, '$1 '))).toEqual(bytes);
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('makes a 160-bit secret', () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('accepts a code one step either side of now, and says which step', () => {
    const now = 1_234_567_890_000;
    const step = totpStep(now);
    const secret = base32Decode(RFC_SECRET);

    expect(verifyTotp(RFC_SECRET, hotp(secret, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, hotp(secret, step + 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, hotp(secret, step - 2), now)).toBeNull();
  });

  it('refuses anything that is not six digits', () => {
    expect(verifyTotp(RFC_SECRET, '12345')).toBeNull();
    expect(verifyTotp(RFC_SECRET, '1234567')).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef')).toBeNull();
  });

  it('builds the URL an authenticator app reads', () => {
    const url = new URL(otpauthUrl('JBSWY3DPEHPK3PXP', 'ada@example.com'));
    expect(url.protocol).toBe('otpauth:');
    expect(url.host).toBe('totp');
    expect(decodeURIComponent(url.pathname)).toBe('/CoreTask:ada@example.com');
    expect(url.searchParams.get('secret')).toBe('JBSWY3DPEHPK3PXP');
    expect(url.searchParams.get('issuer')).toBe('CoreTask');
  });
});

describe('recovery codes', () => {
  it('makes ten distinct codes in groups of four', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    }
    // No characters that read as each other.
    expect(codes.join('')).not.toMatch(/[01ilo]/);
  });

  it('hashes the same code the same however it is typed', () => {
    const hash = hashRecoveryCode('abcd-efgh-jkmn-pqrs');
    expect(hashRecoveryCode('ABCD EFGH JKMN PQRS')).toBe(hash);
    expect(hashRecoveryCode('abcdefghjkmnpqrs')).toBe(hash);
    expect(hashRecoveryCode('abcd-efgh-jkmn-pqrt')).not.toBe(hash);
  });
});
