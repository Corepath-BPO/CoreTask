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

  async login(dto: LoginDto, context: SessionContext): Promise<AuthResult> {
    const user = await this.users.findByEmail(dto.email);

    // Burn the same CPU time when the account is unknown, so response latency
    // does not reveal which e-mail addresses are registered.
    if (!user) {
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
