import { createHash, randomUUID } from 'node:crypto';

import type { AccessTokenPayload, RefreshTokenPayload } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { RefreshToken } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { durationToMs } from '../../common/utils/cookie.util';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  sessionId: string;
  accessExpiresInSeconds: number;
  refreshExpiresInMs: number;
}

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Issues and rotates the token pair.
 *
 * Refresh tokens are signed JWTs *and* persisted as SHA-256 hashes. The
 * signature lets an obviously bogus token be rejected without touching the
 * database; the stored hash is what actually authorises the rotation, which is
 * how revocation and replay detection stay possible.
 */
@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  get accessExpiresInSeconds(): number {
    return Math.floor(durationToMs(this.config.jwt.accessExpiresIn) / 1000);
  }

  get refreshExpiresInMs(): number {
    return durationToMs(this.config.jwt.refreshExpiresIn);
  }

  /** Starts a brand-new token family (login / register). */
  async issueSession(
    user: { id: string; email: string },
    context: SessionContext = {},
  ): Promise<IssuedTokens> {
    return this.issue(user, randomUUID(), 1, context);
  }

  /**
   * Validates the presented refresh token and rotates it.
   *
   * Any token that verifies but is not the currently-active row for its family
   * is treated as a replay: the family is revoked outright, which logs the
   * attacker and the legitimate user out of that session.
   */
  async rotate(
    presentedToken: string,
    context: SessionContext = {},
  ): Promise<IssuedTokens & { userId: string }> {
    const payload = this.verifyRefreshToken(presentedToken);
    const tokenHash = TokenService.hashToken(presentedToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored) {
      // Correct signature but unknown hash: the row was rotated away or purged.
      await this.revokeSession(payload.sid);
      throw AppException.unauthorized('REFRESH_TOKEN_REUSED');
    }

    if (stored.revokedAt !== null) {
      this.logger.warn(
        { userId: stored.userId, sessionId: stored.sessionId },
        'Refresh token replay detected — revoking session family',
      );
      await this.revokeSession(stored.sessionId);
      throw AppException.unauthorized('REFRESH_TOKEN_REUSED');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw AppException.unauthorized('REFRESH_TOKEN_EXPIRED');
    }

    if (!stored.user.isActive) {
      throw AppException.forbidden('ACCOUNT_DISABLED');
    }

    const issued = await this.issue(
      { id: stored.userId, email: stored.user.email },
      stored.sessionId,
      stored.version + 1,
      context,
      stored.id,
    );

    return { ...issued, userId: stored.userId };
  }

  /** Revokes one session family. Used by logout and by replay detection. */
  async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revokes every session for a user.
   *
   * Not wired to an endpoint yet; `POST /auth/logout-all` is a controller method
   * away, and password-reset flows will call this directly.
   */
  async revokeAllForUser(userId: string): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /** Housekeeping for a scheduled job: drop rows that can no longer be used. */
  async purgeExpired(before: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.refreshToken.deleteMany({
      where: { expiresAt: { lt: before } },
    });
    return count;
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    try {
      return this.jwt.verify<RefreshTokenPayload>(token, {
        secret: this.config.jwt.refreshSecret,
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw AppException.unauthorized(expired ? 'REFRESH_TOKEN_EXPIRED' : 'REFRESH_TOKEN_INVALID');
    }
  }

  /** SHA-256 is right here: the token already carries 256+ bits of entropy. */
  static hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async issue(
    user: { id: string; email: string },
    sessionId: string,
    version: number,
    context: SessionContext,
    replacesTokenId?: string,
  ): Promise<IssuedTokens> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      sid: sessionId,
    };
    const refreshPayload: RefreshTokenPayload = {
      sub: user.id,
      sid: sessionId,
      ver: version,
    };

    // Expiry is passed in seconds rather than as `"15m"`: one parser
    // (`durationToMs`) then governs both the JWT lifetime and the cookie
    // `maxAge`, so the two cannot disagree.
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessPayload, {
        secret: this.config.jwt.accessSecret,
        expiresIn: this.accessExpiresInSeconds,
      }),
      this.jwt.signAsync(refreshPayload, {
        secret: this.config.jwt.refreshSecret,
        expiresIn: Math.floor(this.refreshExpiresInMs / 1000),
      }),
    ]);

    const expiresAt = new Date(Date.now() + this.refreshExpiresInMs);

    // Revoking the old row and inserting the new one must be atomic, otherwise a
    // crash between the two leaves the session either dead or replayable.
    await this.prisma.$transaction(async (tx) => {
      const created: RefreshToken = await tx.refreshToken.create({
        data: {
          userId: user.id,
          sessionId,
          tokenHash: TokenService.hashToken(refreshToken),
          version,
          expiresAt,
          userAgent: context.userAgent?.slice(0, 400) ?? null,
          ipAddress: context.ipAddress?.slice(0, 64) ?? null,
        },
      });

      if (replacesTokenId) {
        await tx.refreshToken.update({
          where: { id: replacesTokenId },
          data: { revokedAt: new Date(), replacedById: created.id },
        });
      }
    });

    return {
      accessToken,
      refreshToken,
      sessionId,
      accessExpiresInSeconds: this.accessExpiresInSeconds,
      refreshExpiresInMs: this.refreshExpiresInMs,
    };
  }
}
