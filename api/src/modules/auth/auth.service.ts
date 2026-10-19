import { createHash, randomBytes } from 'node:crypto';

import { PASSWORD_RESET_RESEND_SECONDS, PASSWORD_RESET_TTL_MINUTES } from '@coretask/contracts';
import type { AuthSession, AuthUser } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { EmailQueue } from '../../jobs/email/email.queue';
import { UsersService } from '../users/users.service';

import type { LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordService } from './password.service';
import { type SessionContext, TokenService } from './token.service';

export interface AuthResult {
  session: AuthSession;
  refreshToken: string;
  refreshExpiresInMs: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly emailQueue: EmailQueue,
  ) {}

  async register(dto: RegisterDto, context: SessionContext): Promise<AuthResult> {
    const email = UsersService.normalizeEmail(dto.email);

    if (await this.users.findByEmail(email)) {
      throw AppException.conflict('EMAIL_ALREADY_REGISTERED');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create({ email, name: dto.name, passwordHash });

    const issued = await this.tokens.issueSession(user, context);

    // Fire-and-forget: a mail outage must not fail the registration.
    await this.emailQueue.enqueueWelcome({
      email: user.email,
      name: user.name,
      userId: user.id,
    });

    this.logger.log({ userId: user.id }, 'User registered');

    return this.toAuthResult(UsersService.toAuthUser(user), issued);
  }

  /**
   * "Forgot password": e-mails a link when the address is an active person's
   * account, and does nothing otherwise — the caller gets the same answer
   * either way, so the form cannot be used to find out who has an account.
   *
   * A new link replaces any unused one, and at most one is sent a minute, so
   * the form cannot be used to fill somebody's inbox either.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(UsersService.normalizeEmail(email));
    if (!user || user.isServiceAccount || !user.isActive) return;

    const recent = await this.prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        createdAt: { gt: new Date(Date.now() - PASSWORD_RESET_RESEND_SECONDS * 1_000) },
      },
      select: { id: true },
    });
    if (recent) return;

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash: hashResetToken(token), expiresAt },
      }),
    ]);

    await this.emailQueue.enqueuePasswordReset({
      email: user.email,
      name: user.name,
      token,
      expiresAt: expiresAt.toISOString(),
    });
    this.logger.log({ userId: user.id }, 'Password reset requested');
  }

  /**
   * Sets a new password from a link. The link works once; every session the
   * account had is signed out, since whoever asked may be locking someone
   * else out of a stolen session.
   */
  async resetPassword(token: string, password: string): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
      select: {
        id: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { id: true, isActive: true, isServiceAccount: true } },
      },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.user.isActive ||
      row.user.isServiceAccount
    ) {
      throw AppException.badRequest('PASSWORD_RESET_INVALID');
    }

    // Claimed first, so two tabs submitting the same link cannot both win.
    const claimed = await this.prisma.passwordResetToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw AppException.badRequest('PASSWORD_RESET_INVALID');

    const passwordHash = await this.passwords.hash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: row.user.id }, data: { passwordHash } }),
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: row.user.id, id: { not: row.id } },
      }),
    ]);
    await this.tokens.revokeAllForUser(row.user.id);
    this.logger.log({ userId: row.user.id }, 'Password reset');
  }

  async login(dto: LoginDto, context: SessionContext): Promise<AuthResult> {
    const user = await this.users.findByEmail(dto.email);

    // Burn the same CPU time when the account is unknown, so response latency
    // does not reveal which e-mail addresses are registered.
    if (!user) {
      await this.passwords.verifyAgainstDummy(dto.password);
      throw AppException.unauthorized('INVALID_CREDENTIALS');
    }

    // The account behind an API key has a password nobody knows; refusing it
    // outright keeps that true even if one were ever set.
    if (user.isServiceAccount) {
      await this.passwords.verifyAgainstDummy(dto.password);
      throw AppException.unauthorized('INVALID_CREDENTIALS');
    }

    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw AppException.unauthorized('INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw AppException.forbidden('ACCOUNT_DISABLED');
    }

    const issued = await this.tokens.issueSession(user, context);
    await this.users.markLoggedIn(user.id);

    return this.toAuthResult(UsersService.toAuthUser(user), issued);
  }

  async refresh(presentedToken: string | undefined, context: SessionContext): Promise<AuthResult> {
    if (!presentedToken) {
      throw AppException.unauthorized('REFRESH_TOKEN_INVALID');
    }

    const rotated = await this.tokens.rotate(presentedToken, context);
    const user = await this.users.requireById(rotated.userId);

    return this.toAuthResult(UsersService.toAuthUser(user), rotated);
  }

  /**
   * Ends the current session only. `TokenService.revokeAllForUser` is already
   * in place for the eventual "sign out everywhere" control.
   */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;

    const tokenHash = TokenService.hashToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (stored) {
      await this.tokens.revokeSession(stored.sessionId);
    }
  }

  async me(userId: string): Promise<AuthUser> {
    return UsersService.toAuthUser(await this.users.requireById(userId));
  }

  private toAuthResult(
    user: AuthUser,
    issued: {
      accessToken: string;
      refreshToken: string;
      accessExpiresInSeconds: number;
      refreshExpiresInMs: number;
    },
  ): AuthResult {
    return {
      session: {
        user,
        accessToken: issued.accessToken,
        expiresIn: issued.accessExpiresInSeconds,
      },
      refreshToken: issued.refreshToken,
      refreshExpiresInMs: issued.refreshExpiresInMs,
    };
  }
}

/** SHA-256, as for refresh tokens: the token carries 256 bits, so a slow KDF adds nothing. */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
