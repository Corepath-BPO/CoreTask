import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';

import { hashApiKey } from './lib/api-key-token';

/** A busy integration costs one UPDATE a minute per key, not one per call. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/**
 * Turns a raw API key into the request principal.
 *
 * Deliberately a leaf — Prisma and nothing else — because `JwtAuthGuard` runs
 * on every request and is constructed from the root injector.
 */
@Injectable()
export class ApiKeyAuthService {
  private readonly logger = new Logger(ApiKeyAuthService.name);
  private readonly lastUsedWrites = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async authenticate(rawKey: string): Promise<AuthenticatedUser> {
    const key = await this.prisma.apiKey.findUnique({
      where: { tokenHash: hashApiKey(rawKey) },
      include: { user: { select: { id: true, email: true, isActive: true } } },
    });

    if (!key) {
      throw AppException.unauthorized('API_KEY_INVALID');
    }
    if (key.revokedAt) {
      throw AppException.unauthorized('API_KEY_REVOKED');
    }
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      throw AppException.unauthorized('API_KEY_EXPIRED');
    }
    if (!key.user.isActive) {
      throw AppException.forbidden('ACCOUNT_DISABLED');
    }

    this.recordUse(key.id);

    return {
      id: key.user.id,
      email: key.user.email,
      sessionId: null,
      apiKey: { id: key.id, workspaceId: key.workspaceId, name: key.name },
    };
  }

  /** Best-effort and debounced: `lastUsedAt` is a hint for the settings page, not an audit line. */
  private recordUse(keyId: string): void {
    const now = Date.now();
    const lastWrite = this.lastUsedWrites.get(keyId) ?? 0;

    if (now - lastWrite < LAST_USED_WRITE_INTERVAL_MS) {
      return;
    }
    this.lastUsedWrites.set(keyId, now);

    void this.prisma.apiKey
      .update({ where: { id: keyId }, data: { lastUsedAt: new Date(now) } })
      .catch((error: unknown) => {
        this.logger.warn({ err: error, keyId }, 'Could not record API key use');
      });
  }
}
