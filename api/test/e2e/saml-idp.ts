import { generateKeyPairSync, randomUUID, sign, X509Certificate } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

import { SignedXml } from 'xml-crypto';

/**
 * A stand-in SAML identity provider for the SSO suite: a key pair, a
 * self-signed certificate, and signed responses built the way Okta or Entra
 * build them. Nothing is read from disk and nothing needs `openssl`.
 */
export interface TestIdp {
  privateKey: string;
  /** PEM. */
  certificate: string;
  /** The certificate's base64 alone, as many providers' settings pages show it. */
  certificateBase64: string;
}

export function createTestIdp(commonName = 'CoreTask test IdP'): TestIdp {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const der = selfSignedCertificate(
    commonName,
    publicKey.export({ type: 'spki', format: 'der' }),
    (tbs) => sign('sha256', tbs, privateKey),
  );
  const base64 = der.toString('base64');
  const certificate = `-----BEGIN CERTIFICATE-----\n${base64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  // Fails here, rather than as a puzzling signature error later, if the DER is wrong.
  new X509Certificate(certificate);
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    certificate,
    certificateBase64: base64,
  };
}

/** The AuthnRequest id inside an HTTP-Redirect sign-in URL. */
export function authnRequestId(location: string): string {
  const encoded = new URL(location).searchParams.get('SAMLRequest');
  if (!encoded) throw new Error(`No SAMLRequest in ${location}`);
  const xml = inflateRawSync(Buffer.from(encoded, 'base64')).toString('utf8');
  const id = /\sID="([^"]+)"/.exec(xml)?.[1];
  if (!id) throw new Error(`No ID in the AuthnRequest: ${xml}`);
  return id;
}

export interface ResponseOptions {
  idp: TestIdp;
  issuer: string;
  acsUrl: string;
  audience: string;
  inResponseTo: string;
  nameId: string;
  nameIdFormat?: string;
  attributes?: Record<string, string>;
  /** Signs with this key instead of the IdP's: a forgery. */
  signingKey?: string;
  /** Applied to the signed XML: tampering after the fact. */
  tamper?: (xml: string) => string;
}

/** A `<samlp:Response>` with a signed assertion, base64-encoded as the HTTP-POST binding sends it. */
export function signedResponse(options: ResponseOptions): string {
  const now = new Date();
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();
  const responseId = `_${randomUUID()}`;
  const assertionId = `_${randomUUID()}`;
  const attributes = Object.entries(options.attributes ?? {})
    .map(
      ([name, value]) =>
        `<saml:Attribute Name="${escapeXml(name)}"><saml:AttributeValue>${escapeXml(value)}</saml:AttributeValue></saml:Attribute>`,
    )
    .join('');

  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${responseId}" Version="2.0" IssueInstant="${at(0)}" Destination="${escapeXml(options.acsUrl)}" InResponseTo="${options.inResponseTo}">` +
    `<saml:Issuer>${escapeXml(options.issuer)}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${at(0)}">` +
    `<saml:Issuer>${escapeXml(options.issuer)}</saml:Issuer>` +
    `<saml:Subject>` +
    `<saml:NameID Format="${options.nameIdFormat ?? 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent'}">${escapeXml(options.nameId)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
    `<saml:SubjectConfirmationData NotOnOrAfter="${at(5 * 60_000)}" Recipient="${escapeXml(options.acsUrl)}" InResponseTo="${options.inResponseTo}"/>` +
    `</saml:SubjectConfirmation>` +
    `</saml:Subject>` +
    `<saml:Conditions NotBefore="${at(-60_000)}" NotOnOrAfter="${at(5 * 60_000)}">` +
    `<saml:AudienceRestriction><saml:Audience>${escapeXml(options.audience)}</saml:Audience></saml:AudienceRestriction>` +
    `</saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${at(0)}" SessionIndex="${assertionId}">` +
    `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
    `</saml:AuthnStatement>` +
    (attributes ? `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` : '') +
    `</saml:Assertion>` +
    `</samlp:Response>`;

  const signer = new SignedXml({
    privateKey: options.signingKey ?? options.idp.privateKey,
    publicCert: options.idp.certificate,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  signer.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  // Where the schema puts it: straight after the assertion's Issuer.
  signer.computeSignature(xml, {
    prefix: 'ds',
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });

  const signed = options.tamper ? options.tamper(signer.getSignedXml()) : signer.getSignedXml();
  return Buffer.from(signed, 'utf8').toString('base64');
}

/** A private key nobody configured anywhere, for forging with. */
export function strangerKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Just enough DER to write an X.509 v3 certificate (RFC 5280 §4.1).

function selfSignedCertificate(
  commonName: string,
  subjectPublicKeyInfo: Buffer,
  signTbs: (tbs: Buffer) => Buffer,
): Buffer {
  const sha256WithRsa = sequence(oid('1.2.840.113549.1.1.11'), Buffer.from([0x05, 0x00]));
  const name = sequence(set(sequence(oid('2.5.4.3'), tlv(0x0c, Buffer.from(commonName, 'utf8')))));
  const now = Date.now();
  const tbs = sequence(
    tlv(0xa0, integer(Buffer.from([2]))), // v3
    integer(Buffer.from(randomUUID().replace(/-/g, '').slice(0, 16), 'hex')),
    sha256WithRsa,
    name,
    sequence(utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + 10 * 365 * 86_400_000))),
    name,
    subjectPublicKeyInfo,
  );
  return sequence(tbs, sha256WithRsa, tlv(0x03, Buffer.concat([Buffer.from([0]), signTbs(tbs)])));
}

function tlv(tag: number, body: Buffer): Buffer {
  let length: Buffer;
  if (body.length < 0x80) {
    length = Buffer.from([body.length]);
  } else {
    const bytes: number[] = [];
    for (let n = body.length; n > 0; n >>= 8) bytes.unshift(n & 0xff);
    length = Buffer.from([0x80 | bytes.length, ...bytes]);
  }
  return Buffer.concat([Buffer.from([tag]), length, body]);
}

function sequence(...parts: Buffer[]): Buffer {
  return tlv(0x30, Buffer.concat(parts));
}

function set(...parts: Buffer[]): Buffer {
  return tlv(0x31, Buffer.concat(parts));
}

/** A positive INTEGER: a leading zero keeps the top bit from reading as a sign. */
function integer(value: Buffer): Buffer {
  return tlv(0x02, value[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value);
}

function oid(dotted: string): Buffer {
  const [first, second, ...rest] = dotted.split('.').map(Number);
  const bytes = [first! * 40 + second!];
  for (const arc of rest) {
    const chunk: number[] = [];
    let n = arc;
    do {
      chunk.unshift((n & 0x7f) | (chunk.length ? 0x80 : 0));
      n = Math.floor(n / 128);
    } while (n > 0);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function utcTime(date: Date): Buffer {
  const text = date.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z';
  return tlv(0x17, Buffer.from(text, 'ascii'));
}
