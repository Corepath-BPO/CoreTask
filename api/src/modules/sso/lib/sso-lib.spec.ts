import { createHash } from 'node:crypto';

import type { Profile } from '@node-saml/node-saml';

import { deriveKey } from '../../webhooks/lib/secret-cipher';

import {
  createPkcePair,
  decodeIdToken,
  IdTokenError,
  type IdTokenExpectations,
  MICROSOFT_CONSUMER_TENANT,
  validateIdTokenClaims,
} from './oidc';
import { sanitizeRedirect } from './redirect';
import { normalizeCertificate, readAssertion, serviceProviderUrls } from './saml';
import { openSsoState, sealSsoState, type OidcState } from './sso-state';

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const NOW_S = NOW / 1000;
const TENANT = '72f988bf-86f1-41af-91ab-2d7cd011db47';

const google: IdTokenExpectations = {
  provider: 'google',
  clientId: 'google-client',
  nonce: 'n-123',
  issuer: 'https://accounts.google.com',
};
const microsoft: IdTokenExpectations = {
  provider: 'microsoft',
  clientId: 'ms-client',
  nonce: 'n-456',
  loginUrl: 'https://login.microsoftonline.com',
  tenant: 'common',
};

const googleClaims = (over: Record<string, unknown> = {}) => ({
  iss: 'https://accounts.google.com',
  aud: 'google-client',
  sub: '110169484474386276334',
  email: 'Ada@Example.com',
  email_verified: true,
  name: 'Ada Lovelace',
  nonce: 'n-123',
  iat: NOW_S - 10,
  exp: NOW_S + 3_600,
  ...over,
});

const microsoftClaims = (over: Record<string, unknown> = {}) => ({
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  aud: 'ms-client',
  tid: TENANT,
  oid: '00000000-0000-0000-66f3-3332eca7ea81',
  sub: 'pairwise-sub',
  email: 'bea@contoso.com',
  name: 'Bea Lin',
  nonce: 'n-456',
  iat: NOW_S - 10,
  exp: NOW_S + 3_600,
  ...over,
});

const refusal = (claims: Record<string, unknown>, expected: IdTokenExpectations) => {
  try {
    validateIdTokenClaims(claims, expected, NOW);
  } catch (error) {
    return error instanceof IdTokenError ? error.message : `unexpected ${String(error)}`;
  }
  return null;
};

describe('ID token claims', () => {
  it('reads a Google token: the subject, a lower-cased address it vouches for, the name', () => {
    expect(validateIdTokenClaims(googleClaims(), google, NOW)).toEqual({
      subject: '110169484474386276334',
      email: 'ada@example.com',
      emailTrusted: true,
      name: 'Ada Lovelace',
    });
  });

  it('accepts both of Google’s issuer spellings, and no other', () => {
    expect(refusal(googleClaims({ iss: 'accounts.google.com' }), google)).toBeNull();
    expect(refusal(googleClaims({ iss: 'https://evil.example' }), google)).toMatch(/issuer/);
  });

  it('trusts a Google address only when Google says it is verified', () => {
    const claims = googleClaims({ email_verified: false });
    expect(validateIdTokenClaims(claims, google, NOW).emailTrusted).toBe(false);
    expect(
      validateIdTokenClaims(googleClaims({ email_verified: 'true' }), google, NOW).emailTrusted,
    ).toBe(false);
  });

  it('refuses another app’s token, an expired one, a future one, and another sign-in’s nonce', () => {
    expect(refusal(googleClaims({ aud: 'someone-else' }), google)).toMatch(/another app/);
    expect(refusal(googleClaims({ aud: ['google-client', 'other'] }), google)).toMatch(/azp/);
    expect(
      refusal(googleClaims({ aud: ['google-client', 'other'], azp: 'google-client' }), google),
    ).toBeNull();
    expect(refusal(googleClaims({ exp: NOW_S - 300 }), google)).toMatch(/expired/);
    expect(refusal(googleClaims({ iat: NOW_S + 3_000 }), google)).toMatch(/future/);
    expect(refusal(googleClaims({ nonce: 'n-other' }), google)).toMatch(/nonce/);
    expect(refusal(googleClaims({ nonce: undefined }), google)).toMatch(/nonce/);
  });

  it('forgives a little clock drift', () => {
    expect(refusal(googleClaims({ exp: NOW_S - 60 }), google)).toBeNull();
    expect(refusal(googleClaims({ iat: NOW_S + 60 }), google)).toBeNull();
  });

  it('needs an address', () => {
    expect(refusal(googleClaims({ email: undefined }), google)).toMatch(/email/);
    expect(refusal(googleClaims({ email: 'not an address' }), google)).toMatch(/email/);
  });

  it('names Microsoft people by tenant and object id, not the pairwise sub', () => {
    expect(validateIdTokenClaims(microsoftClaims({ xms_edov: true }), microsoft, NOW)).toEqual({
      subject: `${TENANT}:00000000-0000-0000-66f3-3332eca7ea81`,
      email: 'bea@contoso.com',
      emailTrusted: true,
      name: 'Bea Lin',
    });
  });

  it('trusts a work address only with xms_edov, and a personal account always', () => {
    expect(validateIdTokenClaims(microsoftClaims(), microsoft, NOW).emailTrusted).toBe(false);
    expect(
      validateIdTokenClaims(microsoftClaims({ xms_edov: false }), microsoft, NOW).emailTrusted,
    ).toBe(false);
    const consumer = microsoftClaims({
      tid: MICROSOFT_CONSUMER_TENANT,
      iss: `https://login.microsoftonline.com/${MICROSOFT_CONSUMER_TENANT}/v2.0`,
    });
    expect(validateIdTokenClaims(consumer, microsoft, NOW).emailTrusted).toBe(true);
  });

  it('holds the issuer to the token’s own tenant', () => {
    const other = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    expect(
      refusal(
        microsoftClaims({ iss: `https://login.microsoftonline.com/${other}/v2.0` }),
        microsoft,
      ),
    ).toMatch(/issuer/);
    expect(refusal(microsoftClaims({ tid: 'common' }), microsoft)).toMatch(/tenant/);
    expect(refusal(microsoftClaims({ oid: undefined }), microsoft)).toMatch(/object id/);
  });

  it('keeps to the tenant the app is registered for', () => {
    const only = (tenant: string) => ({ ...microsoft, tenant }) as IdTokenExpectations;
    expect(refusal(microsoftClaims(), only(TENANT))).toBeNull();
    expect(refusal(microsoftClaims(), only('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'))).toMatch(
      /tenant/,
    );
    expect(refusal(microsoftClaims(), only('organizations'))).toBeNull();
    expect(refusal(microsoftClaims(), only('consumers'))).toMatch(/tenant/);
  });

  it('decodes a compact JWT and refuses anything else', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'x' })).toString('base64url');
    expect(decodeIdToken(`e30.${payload}.sig`)).toEqual({ sub: 'x' });
    expect(() => decodeIdToken(undefined)).toThrow(IdTokenError);
    expect(() => decodeIdToken('a.b')).toThrow(IdTokenError);
    expect(() => decodeIdToken('e30.bm90LWpzb24.sig')).toThrow(IdTokenError);
  });

  it('makes an S256 PKCE pair', () => {
    const { verifier, challenge } = createPkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
  });
});

describe('sanitizeRedirect', () => {
  it('keeps a path on the web app, with its query', () => {
    expect(sanitizeRedirect('/projects/42?tab=list')).toBe('/projects/42?tab=list');
    expect(sanitizeRedirect('/')).toBe('/');
  });

  it.each([
    ['another host', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example'],
    ['a backslash read as a slash', '/\\evil.example'],
    ['a tab a parser would drop', '/\t/evil.example'],
    ['a newline', '/a\nb'],
    ['a relative path', 'projects'],
    ['nothing', ''],
    ['a list', ['/a', '/b']],
    ['something too long', `/${'a'.repeat(2_001)}`],
  ])('turns %s into /', (_label, value) => {
    expect(sanitizeRedirect(value)).toBe('/');
  });
});

describe('the SSO cookie', () => {
  const key = deriveKey('test-material:sso');
  const state: OidcState = {
    kind: 'oidc',
    provider: 'google',
    state: 's',
    nonce: 'n',
    codeVerifier: 'v',
    mode: 'login',
    redirect: '/inbox',
  };

  it('comes back as it went, until it runs out', () => {
    const sealed = sealSsoState(key, state, NOW);
    expect(openSsoState(key, sealed, NOW + 60_000)).toEqual(state);
    expect(openSsoState(key, sealed, NOW + 11 * 60_000)).toBeNull();
  });

  it('is unreadable with another key, or altered', () => {
    const sealed = sealSsoState(key, state, NOW);
    expect(openSsoState(deriveKey('other'), sealed, NOW)).toBeNull();
    expect(openSsoState(key, `${sealed.slice(0, -2)}AA`, NOW)).toBeNull();
    expect(openSsoState(key, undefined, NOW)).toBeNull();
  });
});

describe('SAML helpers', () => {
  const body = 'MIIC'.padEnd(200, 'A');

  it('wraps a bare base64 certificate as PEM, and tidies a pasted PEM', () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${body.slice(0, 64)}\n${body.slice(64, 128)}\n${body.slice(128, 192)}\n${body.slice(192)}\n-----END CERTIFICATE-----\n`;
    expect(normalizeCertificate(body)).toBe(pem);
    expect(normalizeCertificate(` ${body.slice(0, 100)}\r\n ${body.slice(100)} `)).toBe(pem);
    expect(
      normalizeCertificate(
        `Subject: x\n-----BEGIN CERTIFICATE-----\r\n${body}\r\n-----END CERTIFICATE-----`,
      ),
    ).toBe(pem);
  });

  it('derives the service provider’s addresses from the connection', () => {
    expect(serviceProviderUrls('https://api.example/api/v1', 'c-1')).toEqual({
      entityId: 'https://api.example/api/v1/auth/sso/saml/c-1/metadata',
      acsUrl: 'https://api.example/api/v1/auth/sso/saml/c-1/acs',
      metadataUrl: 'https://api.example/api/v1/auth/sso/saml/c-1/metadata',
    });
  });

  const profile = (over: Partial<Profile>): Profile =>
    ({
      issuer: 'https://idp.example',
      nameID: 'u-1',
      nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      ...over,
    }) as Profile;

  it('reads the address and name from whichever attribute names the provider uses', () => {
    expect(
      readAssertion(
        profile({
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress': 'Bea@Contoso.com',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname': 'Bea',
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname': ['Lin', 'Other'],
        }),
      ),
    ).toEqual({ nameId: 'u-1', email: 'bea@contoso.com', firstName: 'Bea', lastName: 'Lin' });
  });

  it('falls back on an emailAddress NameID, and otherwise has no address', () => {
    expect(
      readAssertion(
        profile({
          nameID: 'ada@example.com',
          nameIDFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        }),
      )?.email,
    ).toBe('ada@example.com');
    expect(readAssertion(profile({}))?.email).toBeNull();
    expect(readAssertion(profile({ email: 'not-an-address' }))?.email).toBeNull();
    expect(readAssertion(profile({ nameID: '' }))).toBeNull();
  });
});
