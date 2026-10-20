import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS,
  OAUTH_CODE_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_PREFIX,
  OAUTH_SCOPE_DESCRIPTION,
  type OAuthScope,
} from '@coretask/contracts';
import type {
  ConnectedApp,
  OAuthConsent,
  OAuthRedirect,
  OAuthTokenResponse,
} from '@coretask/types';
import type { oauthAuthorizationSchema } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';

import { generateToken, hashToken, sameHash, verifierMatches } from './lib/oauth-token';

type AuthorizationRequest = z.output<typeof oauthAuthorizationSchema>;

/**
 * An error the token and revocation endpoints answer in RFC 6749 §5.2's
 * shape — `{ error, error_description }` — rather than CoreTask's envelope,
 * because that is what every OAuth client library reads.
 */
export class OAuthProtocolError extends Error {
  constructor(
    readonly error:
      | 'invalid_request'
      | 'invalid_client'
      | 'invalid_grant'
      | 'unauthorized_client'
      | 'unsupported_grant_type',
    readonly description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

/** The fields the token endpoint reads, whichever encoding they arrived in. */
export interface TokenRequest {
  grant_type?: unknown;
  code?: unknown;
  redirect_uri?: unknown;
  code_verifier?: unknown;
  refresh_token?: unknown;
  client_id?: unknown;
  client_secret?: unknown;
}

export interface ClientCredentials {
  clientId: string;
  /** Null when only the id was sent — which only a public client may do. */
  clientSecret: string | null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/**
 * The OAuth 2.0 authorization server: consent, codes, tokens and revocation.
 *
 * A confidential client presents its secret on every exchange, with PKCE on
 * top when it sends a challenge; its refresh tokens are long-lived and not
 * rotated, as Asana's are, so a connector that loses a refresh response is not
 * locked out. A public client has no secret: it must send a PKCE challenge on
 * every authorization, and each refresh replaces its refresh token (RFC 9700
 * §4.14), so a stolen one is good once. Either way they end when the person
 * disconnects the app, the developer deletes it, or the app revokes them.
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** What the consent page shows, after checking the request is one CoreTask will honour. */
  async consent(input: AuthorizationRequest): Promise<OAuthConsent> {
    const app = await this.checkRequest(input);
    return {
      app: {
        name: app.name,
        description: app.description,
        websiteUrl: app.websiteUrl,
        publisher: app.owner.name,
      },
      scopes: (input.scope as OAuthScope[]).map((scope) => ({
        scope,
        description: OAUTH_SCOPE_DESCRIPTION[scope],
      })),
      // An app scheme has no host: name the scheme, which is the app.
      redirectHost:
        new URL(input.redirectUri).host || new URL(input.redirectUri).protocol.replace(/:$/, ''),
    };
  }

  /**
   * The person's answer. Allowed: a code for the redirect URI. Refused: the
   * URI with `error=access_denied`, so the tool can say so. Either way the
   * `state` the tool sent comes back with it.
   */
  async authorize(
    userId: string,
    input: AuthorizationRequest & { approve: boolean },
  ): Promise<OAuthRedirect> {
    const app = await this.checkRequest(input);
    const target = new URL(input.redirectUri);

    if (!input.approve) {
      target.searchParams.set('error', 'access_denied');
      target.searchParams.set('error_description', 'The person declined to connect the app.');
    } else {
      const code = generateToken();
      await this.prisma.oAuthAuthorizationCode.create({
        data: {
          appId: app.id,
          userId,
          codeHash: hashToken(code),
          redirectUri: input.redirectUri,
          scopes: input.scope,
          codeChallenge: input.codeChallenge ?? null,
          expiresAt: new Date(Date.now() + OAUTH_CODE_TTL_SECONDS * 1_000),
        },
      });
      target.searchParams.set('code', code);
    }
    if (input.state) target.searchParams.set('state', input.state);

    return { redirectTo: target.toString() };
  }

  /** `POST /oauth/token`: a code or a refresh token for an access token. */
  async token(client: ClientCredentials | null, body: TokenRequest): Promise<OAuthTokenResponse> {
    const app = await this.authenticateClient(client);

    switch (text(body.grant_type)) {
      case 'authorization_code':
        return this.exchangeCode(app, body);
      case 'refresh_token':
        return this.refresh(app, body);
      case null:
        throw new OAuthProtocolError('invalid_request', 'grant_type is required.');
      default:
        throw new OAuthProtocolError(
          'unsupported_grant_type',
          'Use authorization_code or refresh_token.',
        );
    }
  }

  /**
   * `POST /oauth/revoke` (RFC 7009). A refresh token disconnects the grant; an
   * access token ends just that token. An unknown token is not an error — the
   * outcome the app wanted is already true.
   */
  async revoke(client: ClientCredentials | null, body: { token?: unknown }): Promise<void> {
    const app = await this.authenticateClient(client);
    const token = text(body.token);
    if (!token) throw new OAuthProtocolError('invalid_request', 'token is required.');

    if (token.startsWith(OAUTH_REFRESH_TOKEN_PREFIX)) {
      const grant = await this.prisma.oAuthGrant.findUnique({
        where: { refreshTokenHash: hashToken(token) },
        select: { id: true, appId: true },
      });
      if (grant && grant.appId === app.id) await this.revokeGrants([grant.id]);
      return;
    }

    if (token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
      await this.prisma.oAuthAccessToken.deleteMany({
        where: { tokenHash: hashToken(token), grant: { appId: app.id } },
      });
    }
  }

  /** Integrations › Connected apps: one row per app, however many times it was connected. */
  async connectedApps(userId: string): Promise<ConnectedApp[]> {
    const grants = await this.prisma.oAuthGrant.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        scopes: true,
        createdAt: true,
        lastUsedAt: true,
        app: {
          select: { id: true, name: true, websiteUrl: true, owner: { select: { name: true } } },
        },
      },
    });

    const byApp = new Map<string, ConnectedApp>();
    for (const grant of grants) {
      const existing = byApp.get(grant.app.id);
      if (existing) {
        existing.connections += 1;
        existing.scopes = [...new Set([...existing.scopes, ...(grant.scopes as OAuthScope[])])];
        if (
          grant.lastUsedAt &&
          (!existing.lastUsedAt || grant.lastUsedAt.toISOString() > existing.lastUsedAt)
        ) {
          existing.lastUsedAt = grant.lastUsedAt.toISOString();
        }
        continue;
      }
      byApp.set(grant.app.id, {
        app: {
          id: grant.app.id,
          name: grant.app.name,
          websiteUrl: grant.app.websiteUrl,
          publisher: grant.app.owner.name,
        },
        scopes: grant.scopes as OAuthScope[],
        connectedAt: grant.createdAt.toISOString(),
        lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
        connections: 1,
      });
    }
    return [...byApp.values()];
  }

  /** Disconnects every authorization this person gave the app. */
  async disconnect(userId: string, appId: string): Promise<void> {
    const grants = await this.prisma.oAuthGrant.findMany({
      where: { userId, appId, revokedAt: null },
      select: { id: true },
    });
    if (grants.length === 0) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'That app is not connected.');
    }
    await this.revokeGrants(grants.map((grant) => grant.id));
    this.logger.log({ userId, appId }, 'OAuth app disconnected');
  }

  /**
   * Ends grants: their access tokens stop working now, and the webhooks they
   * subscribed are deleted, as Asana deletes a revoked token's webhooks. The
   * grant rows stay, revoked, so a replayed code can still be recognised.
   */
  private async revokeGrants(grantIds: string[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.oAuthGrant.updateMany({
        where: { id: { in: grantIds }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.oAuthAccessToken.deleteMany({ where: { grantId: { in: grantIds } } }),
      this.prisma.webhookEndpoint.deleteMany({ where: { oauthGrantId: { in: grantIds } } }),
    ]);
  }

  private async exchangeCode(
    app: { id: string; isPublic: boolean },
    body: TokenRequest,
  ): Promise<OAuthTokenResponse> {
    const appId = app.id;
    const code = text(body.code);
    const redirectUri = text(body.redirect_uri);
    if (!code || !redirectUri) {
      throw new OAuthProtocolError('invalid_request', 'code and redirect_uri are required.');
    }

    const row = await this.prisma.oAuthAuthorizationCode.findUnique({
      where: { codeHash: hashToken(code) },
    });
    if (!row || row.appId !== appId) {
      throw new OAuthProtocolError('invalid_grant', 'The code is not valid for this app.');
    }

    // Claimed before anything else is checked, so two exchanges racing the
    // same code cannot both win.
    const claimed = await this.prisma.oAuthAuthorizationCode.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) {
      // A replayed code is a leaked code: whatever it bought is revoked too.
      if (row.grantId) await this.revokeGrants([row.grantId]);
      throw new OAuthProtocolError('invalid_grant', 'The code was already used.');
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      throw new OAuthProtocolError('invalid_grant', 'The code has expired. Ask the person again.');
    }
    if (row.redirectUri !== redirectUri) {
      throw new OAuthProtocolError(
        'invalid_grant',
        'redirect_uri must be the one the code was sent to.',
      );
    }
    // A public client's only proof is the verifier; its codes always carry a
    // challenge, so one without is refused rather than trusted.
    if (app.isPublic && !row.codeChallenge) {
      throw new OAuthProtocolError('invalid_grant', 'A public client must use PKCE.');
    }
    if (row.codeChallenge) {
      const verifier = text(body.code_verifier);
      if (!verifier || !verifierMatches(verifier, row.codeChallenge)) {
        throw new OAuthProtocolError('invalid_grant', 'The code_verifier does not match.');
      }
    }

    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!user?.isActive) {
      throw new OAuthProtocolError(
        'invalid_grant',
        'The person who allowed the app is no longer active.',
      );
    }

    const refreshToken = generateToken(OAUTH_REFRESH_TOKEN_PREFIX);
    const grant = await this.prisma.oAuthGrant.create({
      data: {
        appId,
        userId: user.id,
        scopes: row.scopes,
        refreshTokenHash: hashToken(refreshToken),
      },
      select: { id: true, scopes: true },
    });
    await this.prisma.oAuthAuthorizationCode.update({
      where: { id: row.id },
      data: { grantId: grant.id },
    });

    this.logger.log({ appId, userId: user.id, grantId: grant.id }, 'OAuth app connected');

    return {
      ...(await this.issueAccessToken(grant.id)),
      refresh_token: refreshToken,
      scope: grant.scopes.join(' '),
      user: { id: user.id, name: user.name, email: user.email },
    };
  }

  private async refresh(
    app: { id: string; isPublic: boolean },
    body: TokenRequest,
  ): Promise<OAuthTokenResponse> {
    const appId = app.id;
    const refreshToken = text(body.refresh_token);
    if (!refreshToken)
      throw new OAuthProtocolError('invalid_request', 'refresh_token is required.');

    const grant = await this.prisma.oAuthGrant.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
      select: {
        id: true,
        appId: true,
        scopes: true,
        revokedAt: true,
        user: { select: { id: true, name: true, email: true, isActive: true } },
      },
    });
    if (!grant || grant.appId !== appId || grant.revokedAt) {
      throw new OAuthProtocolError('invalid_grant', 'The refresh token is not valid for this app.');
    }
    if (!grant.user.isActive) {
      throw new OAuthProtocolError(
        'invalid_grant',
        'The person who allowed the app is no longer active.',
      );
    }

    // Expired tokens are swept as new ones are issued, so a grant's rows stay few.
    await this.prisma.oAuthAccessToken.deleteMany({
      where: { grantId: grant.id, expiresAt: { lte: new Date() } },
    });

    // A public client's refresh token is replaced on use, compare-and-swap so
    // two refreshes racing the same token cannot both get a new one.
    let rotated: string | null = null;
    if (app.isPublic) {
      rotated = generateToken(OAUTH_REFRESH_TOKEN_PREFIX);
      const swapped = await this.prisma.oAuthGrant.updateMany({
        where: { id: grant.id, refreshTokenHash: hashToken(refreshToken), revokedAt: null },
        data: { refreshTokenHash: hashToken(rotated) },
      });
      if (swapped.count === 0) {
        throw new OAuthProtocolError('invalid_grant', 'The refresh token was already used.');
      }
    }

    return {
      ...(await this.issueAccessToken(grant.id)),
      ...(rotated ? { refresh_token: rotated } : {}),
      scope: grant.scopes.join(' '),
      user: { id: grant.user.id, name: grant.user.name, email: grant.user.email },
    };
  }

  private async issueAccessToken(
    grantId: string,
  ): Promise<{ access_token: string; token_type: 'bearer'; expires_in: number }> {
    const accessToken = generateToken(OAUTH_ACCESS_TOKEN_PREFIX);
    await this.prisma.oAuthAccessToken.create({
      data: {
        grantId,
        tokenHash: hashToken(accessToken),
        expiresAt: new Date(Date.now() + OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1_000),
      },
    });
    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /**
   * The client id and, for a confidential client, its secret, checked in
   * constant time. A public client sends its id alone — it has no secret —
   * and proves itself with PKCE instead. 401 `invalid_client` otherwise.
   */
  private async authenticateClient(
    client: ClientCredentials | null,
  ): Promise<{ id: string; isPublic: boolean }> {
    if (!client) {
      throw new OAuthProtocolError(
        'invalid_client',
        'Send client_id and client_secret, in the body or as HTTP Basic credentials.',
        401,
      );
    }
    const app = await this.prisma.oAuthApp.findUnique({
      where: { clientId: client.clientId },
      select: { id: true, isPublic: true, clientSecretHash: true },
    });
    if (app?.isPublic) return { id: app.id, isPublic: true };
    if (
      !app?.clientSecretHash ||
      !client.clientSecret ||
      !sameHash(app.clientSecretHash, hashToken(client.clientSecret))
    ) {
      throw new OAuthProtocolError('invalid_client', 'The client id or secret is wrong.', 401);
    }
    return { id: app.id, isPublic: false };
  }

  /**
   * An authorization request CoreTask will act on, or a 400 the consent page
   * shows. Never a redirect: until the client and its URI check out, sending
   * the person anywhere would make CoreTask an open redirector.
   */
  private async checkRequest(input: AuthorizationRequest) {
    const app = await this.prisma.oAuthApp.findUnique({
      where: { clientId: input.clientId },
      select: {
        id: true,
        name: true,
        description: true,
        websiteUrl: true,
        redirectUris: true,
        isPublic: true,
        owner: { select: { name: true } },
      },
    });
    if (!app) throw AppException.badRequest('OAUTH_UNKNOWN_CLIENT');
    if (!app.redirectUris.includes(input.redirectUri)) {
      throw AppException.badRequest('OAUTH_REDIRECT_URI_MISMATCH');
    }
    if (input.responseType !== 'code') {
      throw AppException.badRequest(
        'OAUTH_INVALID_REQUEST',
        'Only the authorization-code flow (response_type=code) is supported.',
      );
    }
    if (app.isPublic && !input.codeChallenge) {
      throw AppException.badRequest(
        'OAUTH_INVALID_REQUEST',
        'This app is a public client: send a PKCE code_challenge with code_challenge_method=S256.',
      );
    }
    if (input.codeChallenge && input.codeChallengeMethod !== 'S256') {
      throw AppException.badRequest(
        'OAUTH_INVALID_REQUEST',
        'Send code_challenge_method=S256 with a code challenge.',
      );
    }
    return app;
  }
}
