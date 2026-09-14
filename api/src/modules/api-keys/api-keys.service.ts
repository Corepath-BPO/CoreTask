import { randomBytes, randomUUID } from 'node:crypto';

import {
  API_KEY_ROLES,
  ActivityAction,
  ActivityEntity,
  MAX_API_KEYS_PER_WORKSPACE,
  WorkspaceRole,
  canGrantRole,
  type ApiKeyRole,
} from '@coretask/contracts';
import type { ApiKey as ApiKeyDto, CreatedApiKey, IntegrationWhoAmI } from '@coretask/types';
import type { CreateApiKeyInput, UpdateApiKeyInput } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { PasswordService } from '../auth/password.service';

import { apiKeyInclude, toApiKeyDto } from './api-key.mapper';
import { displayPrefix, generateApiKey, hashApiKey } from './lib/api-key-token';

/** Reserved TLD: undeliverable by construction, and the mailer refuses it outright. */
const SERVICE_ACCOUNT_DOMAIN = 'integrations.coretask.invalid';

interface Actor {
  id: string;
  role: WorkspaceRole;
}

/**
 * Workspace API keys.
 *
 * Each key is backed by a hidden service-account user with its own membership,
 * so the rest of the system needs no notion of "a key did this": tasks, comments
 * and activity lines all point at a user whose name is the key's name.
 */
@Injectable()
export class ApiKeysService {
  private readonly logger = new Logger(ApiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly activity: ActivityLogsService,
  ) {}

  async list(workspaceId: string, includeRevoked: boolean): Promise<ApiKeyDto[]> {
    const rows = await this.prisma.apiKey.findMany({
      where: { workspaceId, ...(includeRevoked ? {} : { revokedAt: null }) },
      include: apiKeyInclude,
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    return rows.map((row) => toApiKeyDto(row, now));
  }

  /** The only place the raw key exists in a response. */
  async create(
    workspaceId: string,
    actor: Actor,
    input: CreateApiKeyInput,
  ): Promise<CreatedApiKey> {
    const role = this.resolveRole(actor.role, input.role);
    await this.assertCapacity(workspaceId);

    const rawKey = generateApiKey();
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 86_400_000)
      : null;
    // Nobody knows this password, and login refuses service accounts anyway.
    const passwordHash = await this.passwords.hash(randomBytes(32).toString('base64url'));

    const row = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `api-key-${randomUUID()}@${SERVICE_ACCOUNT_DOMAIN}`,
          name: input.name,
          passwordHash,
          isServiceAccount: true,
          emailVerifiedAt: new Date(),
        },
      });

      await tx.workspaceMember.create({
        data: { workspaceId, userId: user.id, role, invitedById: actor.id },
      });

      return tx.apiKey.create({
        data: {
          workspaceId,
          userId: user.id,
          name: input.name,
          prefix: displayPrefix(rawKey),
          tokenHash: hashApiKey(rawKey),
          createdById: actor.id,
          expiresAt,
        },
        include: apiKeyInclude,
      });
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.id,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.API_KEY,
      entityId: row.id,
      summary: `Created API key "${row.name}" (${role.toLowerCase()})`,
      metadata: { role, expiresAt: expiresAt?.toISOString() ?? null },
    });
    this.logger.log({ workspaceId, apiKeyId: row.id, role }, 'API key created');

    return { key: toApiKeyDto(row), secret: rawKey };
  }

  async update(
    workspaceId: string,
    actor: Actor,
    apiKeyId: string,
    input: UpdateApiKeyInput,
  ): Promise<ApiKeyDto> {
    const existing = await this.requireKey(workspaceId, apiKeyId);

    if (existing.revokedAt) {
      throw AppException.badRequest('BAD_REQUEST', 'A revoked key cannot be changed.');
    }

    const role = input.role === undefined ? undefined : this.resolveRole(actor.role, input.role);

    const row = await this.prisma.$transaction(async (tx) => {
      if (input.name !== undefined) {
        // The service account is named after the key so activity reads well.
        await tx.user.update({ where: { id: existing.userId }, data: { name: input.name } });
      }
      if (role !== undefined) {
        await tx.workspaceMember.update({
          where: { workspaceId_userId: { workspaceId, userId: existing.userId } },
          data: { role },
        });
      }
      return tx.apiKey.update({
        where: { id: apiKeyId },
        data: input.name === undefined ? {} : { name: input.name },
        include: apiKeyInclude,
      });
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.id,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.API_KEY,
      entityId: row.id,
      summary: `Updated API key "${row.name}"`,
      metadata: { name: input.name ?? null, role: role ?? null },
    });

    return toApiKeyDto(row);
  }

  /**
   * Revoking is final and keeps every row, so "created by n8n" stays true in
   * the history. Two independent checks then refuse the key: `revokedAt` on
   * the row, and `isActive` on the service account. The hash is kept, unlike a
   * revoked invitation's, so the tool is told the key was *revoked* rather than
   * that it was never valid — the fix on their side is different.
   */
  async revoke(workspaceId: string, actor: Actor, apiKeyId: string): Promise<ApiKeyDto> {
    const existing = await this.requireKey(workspaceId, apiKeyId);

    if (existing.revokedAt) {
      return toApiKeyDto(existing);
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: existing.userId }, data: { isActive: false } });
      return tx.apiKey.update({
        where: { id: apiKeyId },
        data: { revokedAt: new Date() },
        include: apiKeyInclude,
      });
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.id,
      action: ActivityAction.DELETED,
      entity: ActivityEntity.API_KEY,
      entityId: row.id,
      summary: `Revoked API key "${row.name}"`,
    });
    this.logger.log({ workspaceId, apiKeyId }, 'API key revoked');

    return toApiKeyDto(row);
  }

  /** What a tool calls first: is my key good, and which workspace am I in? */
  async whoami(principal: AuthenticatedUser): Promise<IntegrationWhoAmI> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: principal.id },
      select: { id: true, name: true, email: true },
    });

    if (!principal.apiKey) {
      return { principal: 'user', user, workspace: null, apiKey: null };
    }

    const workspaceId = principal.apiKey.workspaceId;
    const [workspace, membership] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { id: true, name: true, slug: true },
      }),
      this.prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId, userId: user.id } },
        select: { role: true },
      }),
    ]);

    return {
      principal: 'api_key',
      user,
      workspace,
      apiKey: { id: principal.apiKey.id, name: principal.apiKey.name, role: membership.role },
    };
  }

  private resolveRole(actorRole: WorkspaceRole, requested: string | undefined): ApiKeyRole {
    const role = (requested ?? WorkspaceRole.MEMBER) as WorkspaceRole;

    if (!(API_KEY_ROLES as readonly string[]).includes(role)) {
      throw AppException.unprocessable('API_KEY_ROLE_NOT_ALLOWED');
    }
    if (!canGrantRole(actorRole, role)) {
      throw AppException.forbidden('FORBIDDEN', 'You cannot grant a role above your own.');
    }

    return role as ApiKeyRole;
  }

  private async assertCapacity(workspaceId: string): Promise<void> {
    const active = await this.prisma.apiKey.count({ where: { workspaceId, revokedAt: null } });

    if (active >= MAX_API_KEYS_PER_WORKSPACE) {
      throw AppException.conflict('API_KEY_LIMIT_REACHED');
    }
  }

  private async requireKey(workspaceId: string, apiKeyId: string) {
    const row = await this.prisma.apiKey.findFirst({
      where: { id: apiKeyId, workspaceId },
      include: apiKeyInclude,
    });

    if (!row) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'API key not found.');
    }

    return row;
  }
}
