import { RECENT_SIGN_IN_MINUTES } from '@coretask/contracts';
import type { AccountDeletionPreview, ReauthPayload } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';

import { PasswordService } from './password.service';
import { TwoFactorService } from './two-factor.service';

/**
 * "Confirm it is you", for the changes a stolen session should not be able to
 * make alone: turning two-step verification off, moving the account to a new
 * address, deleting the account or a workspace.
 *
 * The strongest proof the account has is asked for: the password when it has
 * one; otherwise a code from the authenticator app; and for an account with
 * neither — it signs in only through Google, Microsoft or SAML — a sign-in in
 * the last few minutes, since the provider is the only one who can check.
 */
@Injectable()
export class ReauthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  /** Which proof `assert` will ask this account for. */
  static requirementFor(
    user: Pick<User, 'passwordHash' | 'totpEnabledAt'>,
  ): AccountDeletionPreview['reauth'] {
    if (user.passwordHash) return 'password';
    if (user.totpEnabledAt) return 'code';
    return 'recent-sign-in';
  }

  /**
   * Throws unless the payload proves it. A wrong password is a 400 rather
   * than a 401, as in "change password": the session is fine, and a 401
   * would send the client off to refresh it.
   */
  async assert(userId: string, sessionId: string | null, input: ReauthPayload): Promise<User> {
    const user = await this.users.requireById(userId);

    switch (ReauthService.requirementFor(user)) {
      case 'password':
        if (!input.password) throw AppException.badRequest('REAUTH_REQUIRED');
        if (!(await this.passwords.verify(user.passwordHash!, input.password))) {
          throw AppException.badRequest('CURRENT_PASSWORD_INCORRECT');
        }
        return user;

      case 'code':
        if (!input.code) {
          throw AppException.badRequest(
            'REAUTH_REQUIRED',
            'Confirm it is you: enter a code from your authenticator app.',
          );
        }
        await this.twoFactor.verifyCode(user, input.code);
        return user;

      case 'recent-sign-in': {
        const session = sessionId
          ? await this.prisma.refreshToken.findFirst({
              where: { sessionId, userId, revokedAt: null },
              select: { sessionStartedAt: true },
            })
          : null;
        const cutoff = Date.now() - RECENT_SIGN_IN_MINUTES * 60_000;
        if (!session || session.sessionStartedAt.getTime() < cutoff) {
          throw AppException.forbidden('RECENT_SIGN_IN_REQUIRED');
        }
        return user;
      }
    }
  }
}
