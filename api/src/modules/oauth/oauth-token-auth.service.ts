import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';

import { hashToken } from './lib/oauth-token';

/** A busy connector costs one UPDATE a minute per grant, not one per call. */
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/**
 * Turns an OAuth access token into the request principal: the person who
 * allowed the app.
 *
 * A leaf — Prisma and nothing else — because the global `JwtAuthGuard` is
 * built from the root injector and runs on every request, as
 * `ApiKeyAuthService` is for the same reason.
 */
@Injectable()
export class OAuthTokenAuthService {
  private readonly logger = new Logger(OAuthTokenAuthService.name);
  private readonly lastUsedWrites = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async authenticate(rawToken: string): Promise<AuthenticatedUser> {
    const token = await this.prisma.oAuthAccessToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: {
        grant: {
          select: {
            id: true,
            revokedAt: true,
            app: { select: { id: true, name: true } },
            user: { select: { id: true, email: true, isActive: true } },
          },
        },
      },
    });

    // A disconnected app's tokens are deleted with the grant; a revoked grant
    // is refused the same way, so the two cannot be told apart from outside.
    if (!token || token.grant.revokedAt) {
      throw AppException.unauthorized('OAUTH_TOKEN_INVALID');
    }
    if (token.expiresAt.getTime() <= Date.now()) {
      throw AppException.unauthorized('OAUTH_TOKEN_EXPIRED');
    }
    if (!token.grant.user.isActive) {
      throw AppException.forbidden('ACCOUNT_DISABLED');
    }

    this.recordUse(token.grant.id);

    return {
      id: token.grant.user.id,
      email: token.grant.user.email,
      sessionId: null,
      oauth: { grantId: token.grant.id, appId: token.grant.app.id, appName: token.grant.app.name },
    };
  }

  /** Best-effort and debounced: `lastUsedAt` is a hint for Connected apps, not an audit line. */
  private recordUse(grantId: string): void {
    const now = Date.now();
    if (now - (this.lastUsedWrites.get(grantId) ?? 0) < LAST_USED_WRITE_INTERVAL_MS) return;
    this.lastUsedWrites.set(grantId, now);

    void this.prisma.oAuthGrant
      .update({ where: { id: grantId }, data: { lastUsedAt: new Date(now) } })
      .catch((error: unknown) => {
        this.logger.warn({ err: error, grantId }, 'Could not record OAuth grant use');
      });
  }
}
