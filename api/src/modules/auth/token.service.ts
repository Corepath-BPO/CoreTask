import { createHash, randomUUID } from 'node:crypto';

import { SignInMethod } from '@coretask/contracts';
import type { AccessTokenPayload, AccountSession, RefreshTokenPayload } from '@coretask/types';
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

/** What a rotation carries forward from the token it replaces. */
interface SessionOrigin {
  method: SignInMethod;
  startedAt: Date;
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

  /** Starts a brand-new token family: signing in, registering, SSO. */
  async issueSession(
    user: { id: string; email: string },
    context: SessionContext = {},
    method: SignInMethod = SignInMethod.PASSWORD,
  ): Promise<IssuedTokens> {
    return this.issue(user, randomUUID(), 1, context, { method, startedAt: new Date() });
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
      // A refresh that says nothing about where it came from keeps what the
      // session last knew, so the session list does not forget the device.
      {
        userAgent: context.userAgent ?? stored.userAgent ?? undefined,
        ipAddress: context.ipAddress ?? stored.ipAddress ?? undefined,
      },
      { method: stored.method, startedAt: stored.sessionStartedAt },
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
   * Revokes every session for a user — "sign out everywhere", and a password
   * reset — or every session but one, which is how changing a password keeps
   * the device it was changed on signed in.
   */
  async revokeAllForUser(
    userId: string,
    options: { exceptSessionId?: string } = {},
  ): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(options.exceptSessionId ? { sessionId: { not: options.exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /**
   * The account's open sessions, newest activity first. Each family has one
   * unrevoked row — the latest rotation — which carries everything the list
   * shows; its `createdAt` is when the session last refreshed.
   */
  async listSessions(userId: string, currentSessionId: string | null): Promise<AccountSession[]> {
    const rows = await this.prisma.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const seen = new Set<string>();
    const sessions: AccountSession[] = [];
    for (const row of rows) {
      if (seen.has(row.sessionId)) continue;
      seen.add(row.sessionId);
      sessions.push({
        id: row.sessionId,
        current: row.sessionId === currentSessionId,
        method: row.method,
        userAgent: row.userAgent,
        ipAddress: row.ipAddress,
        signedInAt: row.sessionStartedAt.toISOString(),
        lastActiveAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      });
    }
    return sessions;
  }

  /** Ends one of the account's sessions. False when it has no such open session. */
  async revokeSessionOf(userId: string, sessionId: string): Promise<boolean> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0;
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
    origin: SessionOrigin,
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
          method: origin.method,
          sessionStartedAt: origin.startedAt,
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
