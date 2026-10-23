import { createHash, randomBytes } from 'node:crypto';

import {
  EMAIL_VERIFICATION_RESEND_SECONDS,
  EMAIL_VERIFICATION_TTL_HOURS,
  PASSWORD_RESET_RESEND_SECONDS,
  PASSWORD_RESET_TTL_MINUTES,
  SignInMethod,
} from '@coretask/contracts';
import type {
  AuthSession,
  AuthUser,
  ResendVerificationResult,
  TwoFactorChallenge,
  VerifyEmailResult,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { EmailQueue } from '../../jobs/email/email.queue';
import { UsersService } from '../users/users.service';

import type { LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordService } from './password.service';
import { type SessionContext, TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

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
    private readonly twoFactor: TwoFactorService,
  ) {}

  async register(dto: RegisterDto, context: SessionContext): Promise<AuthResult> {
    const email = UsersService.normalizeEmail(dto.email);

    if (await this.users.findByEmail(email)) {
      throw AppException.conflict('EMAIL_ALREADY_REGISTERED');
    }

    const passwordHash = await this.passwords.hash(dto.password);
    const user = await this.users.create({
      email,
      name: dto.name,
      passwordHash,
      emailVerificationDueAt: this.users.emailVerificationDeadline(),
    });

    const issued = await this.tokens.issueSession(user, context);

    // The confirmation link is also the welcome. A failure here must not fail
    // the registration: the account exists, and a new link is one click away.
    try {
      await this.sendEmailVerification(user, { welcome: true });
    } catch (error) {
      this.logger.error({ err: error, userId: user.id }, 'Could not send the e-mail confirmation');
    }

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
    if (!user || user.isServiceAccount || !user.isActive || user.deletedAt) return;

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
        user: { select: { id: true, isActive: true, isServiceAccount: true, deletedAt: true } },
      },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.user.isActive ||
      row.user.isServiceAccount ||
      row.user.deletedAt
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
      // The link was mailed to the address, so using it proves the address.
      this.prisma.user.updateMany({
        where: { id: row.user.id, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date(), emailVerificationDueAt: null },
      }),
    ]);
    await this.tokens.revokeAllForUser(row.user.id);
    this.logger.log({ userId: row.user.id }, 'Password reset');
  }

  async login(dto: LoginDto, context: SessionContext): Promise<AuthResult | TwoFactorChallenge> {
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

    // An account that signs in only with SSO has no password to match.
    if (!user.passwordHash) {
      await this.passwords.verifyAgainstDummy(dto.password);
      throw AppException.unauthorized('INVALID_CREDENTIALS');
    }

    if (!(await this.passwords.verify(user.passwordHash, dto.password))) {
      throw AppException.unauthorized('INVALID_CREDENTIALS');
    }

    if (!user.isActive) {
      throw AppException.forbidden('ACCOUNT_DISABLED');
    }

    return this.completeSignIn(user, context, SignInMethod.PASSWORD);
  }

  /**
   * Where every way of signing in ends — the password, Google, Microsoft,
   * SAML — once it has settled who the person is. With two-step verification
   * on, that earns a challenge rather than a session; the code turns it into
   * one at `verifyTwoFactor`.
   */
  async completeSignIn(
    user: User,
    context: SessionContext,
    method: SignInMethod,
  ): Promise<AuthResult | TwoFactorChallenge> {
    if (user.totpEnabledAt) return this.twoFactor.createChallenge(user.id, method);
    return this.startSession(user, context, method);
  }

  /** The second step: the challenge from the first, and a code. */
  async verifyTwoFactor(
    input: { challenge: string; code: string },
    context: SessionContext,
  ): Promise<AuthResult> {
    const { user, method } = await this.twoFactor.redeemChallenge(input.challenge, input.code);
    return this.startSession(user, context, method);
  }

  private async startSession(
    user: User,
    context: SessionContext,
    method: SignInMethod,
  ): Promise<AuthResult> {
    const issued = await this.tokens.issueSession(user, context, method);
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

  /** Ends the current session only; `logoutEverywhere` ends the rest. */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;

    const tokenHash = TokenService.hashToken(presentedToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (stored) {
      await this.tokens.revokeSession(stored.sessionId);
    }
  }

  /**
   * "Sign out everywhere": every session the account has, this one included.
   * Access tokens already handed out still run to their 15-minute expiry, but
   * none of them can be refreshed.
   */
  async logoutEverywhere(userId: string): Promise<number> {
    const revoked = await this.tokens.revokeAllForUser(userId);
    this.logger.log({ userId, revoked }, 'Signed out everywhere');
    return revoked;
  }

  /**
   * Changes the password from inside a session. Every *other* session is
   * signed out, so whoever else may know the old password loses their way in,
   * while the one that made the change stays signed in.
   *
   * A wrong current password is a 400, not a 401: the session is fine, and a
   * 401 would send the client off to refresh it.
   */
  async changePassword(
    userId: string,
    sessionId: string | null,
    input: { currentPassword: string; newPassword: string },
  ): Promise<void> {
    const user = await this.users.requireById(userId);

    if (!user.passwordHash) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Your account has no password yet. Use "Set a password" to get a link by e-mail.',
      );
    }
    if (!(await this.passwords.verify(user.passwordHash, input.currentPassword))) {
      throw AppException.badRequest('CURRENT_PASSWORD_INCORRECT');
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      // A reset link asked for before the change would undo it.
      this.prisma.passwordResetToken.deleteMany({ where: { userId, usedAt: null } }),
    ]);
    const revoked = await this.tokens.revokeAllForUser(
      userId,
      sessionId ? { exceptSessionId: sessionId } : {},
    );
    this.logger.log({ userId, revoked }, 'Password changed');
  }

  /**
   * Sends a new "confirm your e-mail address" link to a signed-in person.
   *
   * Nothing is sent when the address is already confirmed, or when a link went
   * out less than a minute ago; the answer says which, so the page can.
   */
  async resendEmailVerification(userId: string): Promise<ResendVerificationResult> {
    const user = await this.users.requireById(userId);
    if (user.emailVerifiedAt) return { sent: false, emailVerified: true };

    const recent = await this.prisma.emailVerificationToken.findFirst({
      where: {
        userId,
        createdAt: { gt: new Date(Date.now() - EMAIL_VERIFICATION_RESEND_SECONDS * 1_000) },
      },
      select: { id: true },
    });
    if (recent) return { sent: false, emailVerified: false };

    await this.sendEmailVerification(user, { welcome: false });
    return { sent: true, emailVerified: false };
  }

  /**
   * Confirms an address from a link. Public, because the link may be opened
   * on a device that is not signed in. It works once, and only for the
   * address it was sent to.
   */
  async verifyEmail(token: string): Promise<VerifyEmailResult> {
    const row = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
      select: {
        id: true,
        email: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { id: true, email: true, isActive: true } },
      },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.user.isActive ||
      row.user.email !== row.email
    ) {
      throw AppException.badRequest('EMAIL_VERIFICATION_INVALID');
    }

    const claimed = await this.prisma.emailVerificationToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw AppException.badRequest('EMAIL_VERIFICATION_INVALID');

    await this.prisma.$transaction([
      this.prisma.user.updateMany({
        where: { id: row.user.id, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date(), emailVerificationDueAt: null },
      }),
      this.prisma.emailVerificationToken.deleteMany({
        where: { userId: row.user.id, id: { not: row.id } },
      }),
    ]);
    this.logger.log({ userId: row.user.id }, 'E-mail address confirmed');
    return { email: row.email };
  }

  async me(userId: string): Promise<AuthUser> {
    return UsersService.toAuthUser(await this.users.requireById(userId));
  }

  /** Writes a new link, replacing any unused one, and queues the e-mail. */
  private async sendEmailVerification(
    user: { id: string; email: string; name: string },
    options: { welcome: boolean },
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_HOURS * 3_600_000);
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.deleteMany({ where: { userId: user.id, usedAt: null } }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          email: user.email,
          tokenHash: hashResetToken(token),
          expiresAt,
        },
      }),
    ]);

    await this.emailQueue.enqueueEmailVerification({
      userId: user.id,
      email: user.email,
      name: user.name,
      token,
      expiresAt: expiresAt.toISOString(),
      welcome: options.welcome,
    });
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

/**
 * SHA-256, as for refresh tokens: the token carries 256 bits, so a slow KDF adds
 * nothing. Used for reset and e-mail confirmation links alike.
 */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
