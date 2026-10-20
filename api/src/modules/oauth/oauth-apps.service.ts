import {
  MAX_OAUTH_APPS_PER_USER,
  OAUTH_CLIENT_ID_PREFIX,
  OAUTH_CLIENT_SECRET_PREFIX,
} from '@coretask/contracts';
import type { CreatedOAuthApp, OAuthApp, OAuthSecretRotation } from '@coretask/types';
import type { CreateOAuthAppInput, UpdateOAuthAppInput } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';

import { generateToken, hashToken, secretHint } from './lib/oauth-token';

const appInclude = {
  _count: { select: { grants: { where: { revokedAt: null } } } },
} satisfies Prisma.OAuthAppInclude;

type AppRow = Prisma.OAuthAppGetPayload<{ include: typeof appInclude }>;

/** Never the secret: it is returned by create and rotate, and nowhere else. */
function toOAuthAppDto(row: AppRow): OAuthApp {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    websiteUrl: row.websiteUrl,
    redirectUris: row.redirectUris,
    clientId: row.clientId,
    secretHint: row.secretHint,
    connections: row._count.grants,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The apps a developer registered.
 *
 * Owned by a person rather than a workspace, as in Asana's developer console:
 * an app is a tool that acts for whoever connects it, in whichever workspaces
 * they belong to, so no one workspace is where it lives.
 */
@Injectable()
export class OAuthAppsService {
  private readonly logger = new Logger(OAuthAppsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(ownerId: string): Promise<OAuthApp[]> {
    const rows = await this.prisma.oAuthApp.findMany({
      where: { ownerId },
      include: appInclude,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toOAuthAppDto);
  }

  async create(ownerId: string, input: CreateOAuthAppInput): Promise<CreatedOAuthApp> {
    const count = await this.prisma.oAuthApp.count({ where: { ownerId } });
    if (count >= MAX_OAUTH_APPS_PER_USER) throw AppException.conflict('OAUTH_APP_LIMIT_REACHED');

    const clientSecret = generateToken(OAUTH_CLIENT_SECRET_PREFIX);
    const row = await this.prisma.oAuthApp.create({
      data: {
        ownerId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        websiteUrl: input.websiteUrl?.trim() || null,
        redirectUris: [...new Set(input.redirectUris.map((uri) => uri.trim()))],
        clientId: generateToken(OAUTH_CLIENT_ID_PREFIX),
        clientSecretHash: hashToken(clientSecret),
        secretHint: secretHint(clientSecret),
      },
      include: appInclude,
    });

    this.logger.log({ ownerId, appId: row.id }, 'OAuth app registered');
    return { app: toOAuthAppDto(row), clientSecret };
  }

  /**
   * Narrowing the redirect URIs takes effect at once for new authorizations;
   * apps already connected keep working, because a token was never tied to
   * the URI that fetched its code.
   */
  async update(ownerId: string, appId: string, input: UpdateOAuthAppInput): Promise<OAuthApp> {
    await this.requireOwned(ownerId, appId);
    const row = await this.prisma.oAuthApp.update({
      where: { id: appId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description?.trim() || null }
          : {}),
        ...(input.websiteUrl !== undefined ? { websiteUrl: input.websiteUrl?.trim() || null } : {}),
        ...(input.redirectUris !== undefined
          ? { redirectUris: [...new Set(input.redirectUris.map((uri) => uri.trim()))] }
          : {}),
      },
      include: appInclude,
    });
    return toOAuthAppDto(row);
  }

  /** The old secret stops working at once, so the tool must be updated before its next refresh. */
  async rotateSecret(ownerId: string, appId: string): Promise<OAuthSecretRotation> {
    await this.requireOwned(ownerId, appId);
    const clientSecret = generateToken(OAUTH_CLIENT_SECRET_PREFIX);
    await this.prisma.oAuthApp.update({
      where: { id: appId },
      data: { clientSecretHash: hashToken(clientSecret), secretHint: secretHint(clientSecret) },
    });
    this.logger.log({ ownerId, appId }, 'OAuth app secret rotated');
    return { clientSecret };
  }

  /**
   * Gone for everyone who connected it: the grants, their tokens and the
   * webhooks they subscribed go with the app, by cascade.
   */
  async remove(ownerId: string, appId: string): Promise<void> {
    await this.requireOwned(ownerId, appId);
    await this.prisma.oAuthApp.delete({ where: { id: appId } });
    this.logger.log({ ownerId, appId }, 'OAuth app deleted');
  }

  private async requireOwned(ownerId: string, appId: string): Promise<void> {
    const app = await this.prisma.oAuthApp.findFirst({
      where: { id: appId, ownerId },
      select: { id: true },
    });
    if (!app) throw AppException.notFound('RESOURCE_NOT_FOUND', 'OAuth app not found.');
  }
}
