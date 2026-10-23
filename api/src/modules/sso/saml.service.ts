import { SSO_STATE_TTL_SECONDS, type ErrorCode } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { generateServiceProviderMetadata, SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { SamlConnection } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { decryptSecret, deriveKey, encryptSecret } from '../webhooks/lib/secret-cipher';

import {
  normalizeCertificate,
  readAssertion,
  RedisSamlRequestCache,
  type SamlAssertion,
  serviceProviderUrls,
  type ServiceProviderUrls,
} from './lib/saml';

/** How long the ACS's verdict may wait for the browser to carry it to `finish`. */
const RESULT_TTL_MS = 60_000;
/** Clocks at the identity provider drift; a couple of minutes either way is forgiven. */
const CLOCK_SKEW_MS = 2 * 60_000;

/** What the ACS hands to `finish`, through the browser, sealed. */
export type SamlResult =
  | { connectionId: string; relayState: string; error: ErrorCode }
  | { connectionId: string; relayState: string; assertion: SamlAssertion };

/**
 * A workspace's own identity provider, by SAML 2.0: CoreTask sends a signed-
 * in-nowhere browser there with an AuthnRequest (HTTP-Redirect binding) and
 * takes the signed assertion it posts back.
 *
 * Only responses to requests CoreTask made are accepted (`InResponseTo`,
 * checked against Redis), each once, and only with an assertion signed by
 * the certificate the workspace's admins configured.
 */
@Injectable()
export class SamlService {
  private readonly logger = new Logger(SamlService.name);
  private readonly resultKey: Buffer;
  private readonly requests: RedisSamlRequestCache;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {
    this.resultKey = deriveKey(`${config.webhooks.encryptionKeyMaterial}:sso:saml-result`);
    this.requests = new RedisSamlRequestCache(redis.client, SSO_STATE_TTL_SECONDS);
  }

  serviceProvider(connectionId: string): ServiceProviderUrls {
    return serviceProviderUrls(this.config.sso.apiBase, connectionId);
  }

  /**
   * The connection to sign in through: the workspace's, by its slug, or
   * whichever workspace has verified the address's domain. Null unless it is
   * turned on.
   */
  async findForSignIn(input: {
    workspace?: unknown;
    email?: unknown;
  }): Promise<SamlConnection | null> {
    if (typeof input.workspace === 'string' && input.workspace.trim()) {
      const workspace = await this.prisma.workspace.findUnique({
        where: { slug: input.workspace.trim().toLowerCase().slice(0, 100) },
        select: { archivedAt: true, samlConnection: true },
      });
      const connection = workspace && !workspace.archivedAt ? workspace.samlConnection : null;
      return connection?.enabled ? connection : null;
    }

    if (typeof input.email === 'string') {
      const domain = input.email.trim().toLowerCase().split('@').at(-1)?.replace(/\.$/, '');
      if (!domain || !input.email.includes('@') || domain.length > 253) return null;
      const claimed = await this.prisma.workspaceDomain.findFirst({
        where: { domain, verifiedAt: { not: null }, workspace: { archivedAt: null } },
        select: { workspace: { select: { samlConnection: true } } },
      });
      const connection = claimed?.workspace.samlConnection ?? null;
      return connection?.enabled ? connection : null;
    }

    return null;
  }

  async enabledForWorkspace(workspaceId: string): Promise<SamlConnection> {
    const connection = await this.prisma.samlConnection.findUnique({ where: { workspaceId } });
    if (!connection?.enabled) throw AppException.notFound('SAML_NOT_CONFIGURED');
    return connection;
  }

  async requireEnabled(connectionId: string): Promise<SamlConnection> {
    const connection = await this.prisma.samlConnection.findUnique({ where: { id: connectionId } });
    if (!connection?.enabled) throw AppException.notFound('SAML_NOT_CONFIGURED');
    return connection;
  }

  /** The identity provider's sign-in page, with an AuthnRequest whose id is remembered. */
  authorizeUrl(connection: SamlConnection, relayState: string): Promise<string> {
    return this.client(connection).getAuthorizeUrlAsync(relayState, undefined, {});
  }

  /**
   * Checks what the identity provider posted to the ACS and seals the
   * verdict, good or bad, for `finish`. Never throws: whatever happens, the
   * browser goes on to `finish`, which knows from the cookie whether the
   * person was signing in or connecting, and so where to send them.
   */
  async consume(connectionId: string, body: Record<string, unknown>): Promise<string> {
    const relayState =
      typeof body['RelayState'] === 'string' ? body['RelayState'].slice(0, 200) : '';
    const fail = (error: ErrorCode) => this.sealResult({ connectionId, relayState, error });

    const samlResponse = body['SAMLResponse'];
    if (typeof samlResponse !== 'string' || samlResponse.length === 0) return fail('SSO_FAILED');

    const connection = await this.prisma.samlConnection.findUnique({ where: { id: connectionId } });
    if (!connection?.enabled) return fail('SAML_NOT_CONFIGURED');

    try {
      const { profile } = await this.client(connection).validatePostResponseAsync({
        SAMLResponse: samlResponse,
      });
      if (!profile) return fail('SSO_FAILED');

      // node-saml compares the issuer to `idpIssuer` for logout messages
      // only. The signature already ties the assertion to this provider's
      // key, but a provider that hosts several entities with one key would
      // otherwise speak for all of them.
      if (profile.issuer !== connection.idpEntityId) {
        this.logger.warn(
          { connectionId, issuer: profile.issuer },
          'Refused a SAML assertion from another issuer',
        );
        return fail('SSO_FAILED');
      }

      // node-saml looks the request id up and then forgets it, in two steps;
      // two copies of one response posted at once could both pass between
      // them. Claiming it here, atomically, makes each response good once.
      const requestId = profile['inResponseTo'];
      if (typeof requestId !== 'string' || !(await this.claimResponse(requestId))) {
        return fail('SSO_FAILED');
      }

      const assertion = readAssertion(profile);
      if (!assertion) return fail('SSO_FAILED');
      return this.sealResult({ connectionId, relayState, assertion });
    } catch (error) {
      this.logger.warn(
        { connectionId, err: error instanceof Error ? error.message : String(error) },
        'Refused a SAML response',
      );
      return fail('SSO_FAILED');
    }
  }

  /** The verdict `consume` sealed, or null when it is not one, or is over a minute old. */
  openResult(value: unknown, now = Date.now()): SamlResult | null {
    if (typeof value !== 'string' || value.length === 0 || value.length > 8_000) return null;
    try {
      const parsed = JSON.parse(decryptSecret(value, this.resultKey)) as SamlResult & {
        exp?: unknown;
      };
      if (typeof parsed.exp !== 'number' || parsed.exp <= now) return null;
      const { exp: _exp, ...result } = parsed;
      return result as SamlResult;
    } catch {
      return null;
    }
  }

  /**
   * What an admin gives their identity provider, as XML. Served while setting
   * up too, before the provider's own details are in: nothing of theirs is
   * in it.
   */
  async metadata(connectionId: string): Promise<string> {
    const connection = await this.prisma.samlConnection.findUnique({
      where: { id: connectionId },
      select: { id: true },
    });
    if (!connection) throw AppException.notFound('SAML_NOT_CONFIGURED');
    const sp = this.serviceProvider(connection.id);
    return generateServiceProviderMetadata({
      issuer: sp.entityId,
      callbackUrl: sp.acsUrl,
      wantAssertionsSigned: true,
      identifierFormat: null,
    });
  }

  private sealResult(result: SamlResult): string {
    return encryptSecret(
      JSON.stringify({ ...result, exp: Date.now() + RESULT_TTL_MS }),
      this.resultKey,
    );
  }

  private async claimResponse(requestId: string): Promise<boolean> {
    const claimed = await this.redis.client.set(
      `coretask:saml:consumed:${requestId}`,
      '1',
      'EX',
      SSO_STATE_TTL_SECONDS,
      'NX',
    );
    return claimed === 'OK';
  }

  /** One per request: cheap to build, and a connection's settings may change between requests. */
  private client(connection: SamlConnection): SAML {
    const sp = this.serviceProvider(connection.id);
    return new SAML({
      issuer: sp.entityId,
      callbackUrl: sp.acsUrl,
      audience: sp.entityId,
      entryPoint: connection.idpSsoUrl,
      idpIssuer: connection.idpEntityId,
      idpCert: normalizeCertificate(connection.idpCertificate),
      // The assertion is what carries the person, so it must be signed.
      // Whether the envelope around it is too is up to the provider: Entra
      // and Okta sign only the assertion unless told otherwise.
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: SSO_STATE_TTL_SECONDS * 1_000,
      cacheProvider: this.requests,
      acceptedClockSkewMs: CLOCK_SKEW_MS,
      // Let the provider use the NameID format it is configured for, and
      // whatever way of signing in it requires: asking for "password over
      // TLS" exactly would refuse people who sign in with a passkey or MFA.
      identifierFormat: null,
      disableRequestedAuthnContext: true,
      signatureAlgorithm: 'sha256',
    });
  }
}
