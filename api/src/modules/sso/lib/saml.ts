import type { CacheItem, CacheProvider, Profile } from '@node-saml/node-saml';
import type { Redis } from 'ioredis';

/** What CoreTask, as the service provider, tells an identity provider about itself. */
export interface ServiceProviderUrls {
  entityId: string;
  acsUrl: string;
  metadataUrl: string;
}

/** The parts of a validated assertion CoreTask uses. */
export interface SamlAssertion {
  nameId: string;
  /** Lower-cased; null when the provider sent no address. */
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

const EMAIL_FORMAT = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const NAME_ID_MAX_LENGTH = 500;

/*
 * Attribute names for the same three things differ by provider: Entra and
 * ADFS use the WS-Federation claim URIs, Okta and Google Workspace whatever
 * the admin typed, LDAP-minded ones the X.500 OIDs. The common spellings are
 * tried in turn.
 */
const EMAIL_ATTRIBUTES = [
  'email',
  'mail',
  'emailAddress',
  'Email',
  'EmailAddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'http://schemas.xmlsoap.org/claims/EmailAddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];
const FIRST_NAME_ATTRIBUTES = [
  'firstName',
  'givenName',
  'given_name',
  'FirstName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
  'urn:oid:2.5.4.42',
];
const LAST_NAME_ATTRIBUTES = [
  'lastName',
  'surname',
  'sn',
  'family_name',
  'LastName',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
  'urn:oid:2.5.4.4',
];

/**
 * Everything derives from the connection's id, so the addresses an admin
 * copies into their identity provider never change once given out.
 */
export function serviceProviderUrls(apiBase: string, connectionId: string): ServiceProviderUrls {
  const base = `${apiBase}/auth/sso/saml/${connectionId}`;
  return { entityId: `${base}/metadata`, acsUrl: `${base}/acs`, metadataUrl: `${base}/metadata` };
}

/**
 * The certificate as PEM. Providers show it either way — Okta and Entra
 * offer a PEM download, many settings pages a bare base64 box — and people
 * paste whichever they find, so a bare one is wrapped here.
 */
export function normalizeCertificate(input: string): string {
  const pem = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(input);
  const body = (pem ? pem[1]! : input).replace(/[^A-Za-z0-9+/=]/g, '');
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

/** The person in a validated profile: their NameID, and an address and name if the provider sent them. */
export function readAssertion(profile: Profile): SamlAssertion | null {
  const nameId = typeof profile.nameID === 'string' ? profile.nameID.trim() : '';
  if (!nameId || nameId.length > NAME_ID_MAX_LENGTH) return null;

  const attribute = (names: string[]): string | null => {
    for (const name of names) {
      const raw = profile[name];
      const value = Array.isArray(raw) ? raw.find((item) => typeof item === 'string') : raw;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return null;
  };

  // An emailAddress NameID is the address, when no attribute says otherwise.
  const rawEmail =
    attribute(EMAIL_ATTRIBUTES) ?? (profile.nameIDFormat === EMAIL_FORMAT ? nameId : null);
  const email = rawEmail?.toLowerCase() ?? null;

  return {
    nameId,
    email: email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    firstName: attribute(FIRST_NAME_ATTRIBUTES)?.slice(0, 60) ?? null,
    lastName: attribute(LAST_NAME_ATTRIBUTES)?.slice(0, 60) ?? null,
  };
}

/**
 * Where node-saml keeps the ids of the sign-in requests it has sent, so a
 * response is accepted only for a request CoreTask made, and only once — in
 * Redis rather than in memory, because the browser may come back to a
 * different API instance than the one it left from.
 */
export class RedisSamlRequestCache implements CacheProvider {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
    private readonly prefix = 'coretask:saml:request:',
  ) {}

  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    const stored = await this.redis.set(this.prefix + key, value, 'EX', this.ttlSeconds, 'NX');
    return stored === 'OK' ? { value, createdAt: Date.now() } : null;
  }

  getAsync(key: string): Promise<string | null> {
    return this.redis.get(this.prefix + key);
  }

  async removeAsync(key: string | null): Promise<string | null> {
    if (!key) return null;
    const value = await this.redis.get(this.prefix + key);
    await this.redis.del(this.prefix + key);
    return value;
  }
}
