import { randomUUID } from 'node:crypto';

import {
  SignInMethod,
  TWO_FACTOR_CHALLENGE_TTL_SECONDS,
  TWO_FACTOR_MAX_ATTEMPTS,
  TWO_FACTOR_SETUP_TTL_SECONDS,
} from '@coretask/contracts';
import type {
  TwoFactorChallenge,
  TwoFactorRecoveryCodes,
  TwoFactorSetup,
  TwoFactorStatus,
} from '@coretask/types';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { User } from '@prisma/client';
import QRCode from 'qrcode';

import { AppException } from '../../common/exceptions/app.exception';
import { openToken, sealToken } from '../../common/utils/sealed-token';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { UsersService } from '../users/users.service';
import { decryptSecret, deriveKey, encryptSecret } from '../webhooks/lib/secret-cipher';

import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from './lib/totp';
import { SecurityNotices } from './security-notices';

const SETUP_PURPOSE = 'two-factor-setup';
const CHALLENGE_PURPOSE = 'two-factor-challenge';

/** Wrong codes an account may get, across all its sign-ins, before it is told to wait. */
const ACCOUNT_FAILURE_LIMIT = 20;
const ACCOUNT_FAILURE_WINDOW_SECONDS = 15 * 60;

interface SetupClaim {
  userId: string;
  secret: string;
}

interface ChallengeClaim {
  userId: string;
  method: SignInMethod;
  /** Counts this challenge's wrong codes in Redis. */
  jti: string;
}

/**
 * Two-step verification with an authenticator app, and the recovery codes
 * that stand in for it.
 *
 * Setting up never writes half a state: the secret travels sealed between
 * "show me the QR code" and "here is the first code", and lands in the
 * database only once a code has proved the app has it. Signing in is two
 * requests the same way — the password (or SSO) earns a sealed challenge, and
 * the challenge plus a code earns the session.
 *
 * A code is accepted once: the step it matched is kept, and a code for that
 * step or an earlier one is refused. A recovery code is spent when used.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private readonly secretKey: Buffer;
  private readonly sealKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly redis: RedisService,
    private readonly notices: SecurityNotices,
    config: AppConfigService,
  ) {
    const material = config.webhooks.encryptionKeyMaterial;
    this.secretKey = deriveKey(`${material}:two-factor-secrets`);
    this.sealKey = deriveKey(`${material}:two-factor-tokens`);
  }

  async status(userId: string): Promise<TwoFactorStatus> {
    const user = await this.users.requireById(userId);
    const remaining = user.totpEnabledAt
      ? await this.prisma.twoFactorRecoveryCode.count({ where: { userId, usedAt: null } })
      : 0;
    return {
      enabled: user.totpEnabledAt !== null,
      enabledAt: user.totpEnabledAt?.toISOString() ?? null,
      recoveryCodesRemaining: remaining,
    };
  }

  /** A new secret, as a QR code and as text. Nothing is saved until `enable`. */
  async setup(userId: string): Promise<TwoFactorSetup> {
    const user = await this.users.requireById(userId);
    if (user.totpEnabledAt) throw AppException.conflict('TWO_FACTOR_ALREADY_ENABLED');

    const secret = generateTotpSecret();
    const url = otpauthUrl(secret, user.email);
    const qrSvg = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    const setupToken = sealToken<SetupClaim>(
      this.sealKey,
      SETUP_PURPOSE,
      { userId, secret },
      TWO_FACTOR_SETUP_TTL_SECONDS,
    );
    return { secret, otpauthUrl: url, qrSvg, setupToken };
  }

  /**
   * Turns it on once the first code checks out, and hands back the recovery
   * codes — the only time they are ever readable.
   */
  async enable(
    userId: string,
    input: { setupToken: string; code: string },
  ): Promise<TwoFactorRecoveryCodes> {
    const claim = openToken<SetupClaim>(this.sealKey, SETUP_PURPOSE, input.setupToken);
    if (!claim || claim.userId !== userId)
      throw AppException.badRequest('TWO_FACTOR_SETUP_INVALID');

    const step = verifyTotp(claim.secret, input.code);
    if (step === null) throw AppException.badRequest('TWO_FACTOR_CODE_INVALID');

    const codes = generateRecoveryCodes();
    const enabled = await this.prisma.$transaction(async (tx) => {
      // Conditional, so two tabs finishing setup at once cannot both win.
      const { count } = await tx.user.updateMany({
        where: { id: userId, totpEnabledAt: null },
        data: {
          totpSecret: encryptSecret(claim.secret, this.secretKey),
          totpEnabledAt: new Date(),
          totpLastStep: step,
        },
      });
      if (count === 0) return false;
      await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
      await tx.twoFactorRecoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
      });
      return true;
    });
    if (!enabled) throw AppException.conflict('TWO_FACTOR_ALREADY_ENABLED');

    this.logger.log({ userId }, 'Two-step verification turned on');
    await this.notices.send(userId, {
      subject: 'Two-step verification is on for your CoreTask account',
      heading: 'Two-step verification is on',
      lines: [
        'Signing in to CoreTask now takes a code from your authenticator app as well as your password.',
        'Keep your recovery codes somewhere safe: each one gets you in once if you lose your phone.',
      ],
    });
    return { recoveryCodes: codes };
  }

  /** The caller has already confirmed it is them (`ReauthService`). */
  async disable(userId: string): Promise<void> {
    const { count } = await this.prisma.user.updateMany({
      where: { id: userId, totpEnabledAt: { not: null } },
      data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null },
    });
    if (count === 0) throw AppException.badRequest('TWO_FACTOR_NOT_ENABLED');
    await this.prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } });

    this.logger.warn({ userId }, 'Two-step verification turned off');
    await this.notices.send(userId, {
      subject: 'Two-step verification is off for your CoreTask account',
      heading: 'Two-step verification is off',
      lines: ['Signing in to CoreTask no longer asks for a code from your authenticator app.'],
    });
  }

  /** A fresh set; the old codes stop working. The caller has confirmed it is them. */
  async regenerateRecoveryCodes(userId: string): Promise<TwoFactorRecoveryCodes> {
    const user = await this.users.requireById(userId);
    if (!user.totpEnabledAt) throw AppException.badRequest('TWO_FACTOR_NOT_ENABLED');

    const codes = generateRecoveryCodes();
    await this.prisma.$transaction([
      this.prisma.twoFactorRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.twoFactorRecoveryCode.createMany({
        data: codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })),
      }),
    ]);
    this.logger.log({ userId }, 'Recovery codes replaced');
    return { recoveryCodes: codes };
  }

  /** The half-way point of signing in, for an account with two-step verification on. */
  createChallenge(userId: string, method: SignInMethod): TwoFactorChallenge {
    return {
      twoFactorRequired: true,
      challenge: sealToken<ChallengeClaim>(
        this.sealKey,
        CHALLENGE_PURPOSE,
        { userId, method, jti: randomUUID() },
        TWO_FACTOR_CHALLENGE_TTL_SECONDS,
      ),
      expiresIn: TWO_FACTOR_CHALLENGE_TTL_SECONDS,
    };
  }

  /**
   * The second half: a challenge and a code, for the user to sign in. A
   * challenge allows a handful of wrong codes and then has to be started over
   * from the password, which is rate limited on its own.
   */
  async redeemChallenge(
    challenge: string,
    code: string,
  ): Promise<{ user: User; method: SignInMethod }> {
    const claim = openToken<ChallengeClaim>(this.sealKey, CHALLENGE_PURPOSE, challenge);
    if (!claim) throw AppException.unauthorized('TWO_FACTOR_CHALLENGE_INVALID');

    const attemptsKey = `coretask:2fa:challenge:${claim.jti}`;
    const attempts = await this.redis.client.incr(attemptsKey);
    if (attempts === 1) {
      await this.redis.client.expire(attemptsKey, TWO_FACTOR_CHALLENGE_TTL_SECONDS);
    }
    if (attempts > TWO_FACTOR_MAX_ATTEMPTS) {
      throw AppException.unauthorized('TWO_FACTOR_CHALLENGE_INVALID');
    }

    const user = await this.users.findById(claim.userId);
    if (!user || user.isServiceAccount || user.deletedAt) {
      throw AppException.unauthorized('TWO_FACTOR_CHALLENGE_INVALID');
    }
    if (!user.isActive) throw AppException.forbidden('ACCOUNT_DISABLED');
    // Turned off between the password and the code: the password was enough.
    if (!user.totpEnabledAt) return { user, method: claim.method };

    await this.verifyCode(user, code);
    await this.redis.client.del(attemptsKey);
    return { user, method: claim.method };
  }

  /**
   * Checks a code from the app, or spends a recovery code. Throws on a wrong
   * one, and counts it against the account.
   */
  async verifyCode(user: User, rawCode: string): Promise<void> {
    if (!user.totpEnabledAt || !user.totpSecret) {
      throw AppException.badRequest('TWO_FACTOR_NOT_ENABLED');
    }
    const failuresKey = `coretask:2fa:failures:${user.id}`;
    const failures = Number((await this.redis.client.get(failuresKey)) ?? 0);
    if (failures >= ACCOUNT_FAILURE_LIMIT) {
      throw new AppException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many wrong codes. Wait 15 minutes, then try again.',
      );
    }

    const code = rawCode.replace(/\s+/g, '');
    const accepted = /^\d+$/.test(code)
      ? await this.acceptTotp(user, code)
      : await this.spendRecoveryCode(user, code);

    if (!accepted) {
      const count = await this.redis.client.incr(failuresKey);
      if (count === 1) await this.redis.client.expire(failuresKey, ACCOUNT_FAILURE_WINDOW_SECONDS);
      throw AppException.badRequest('TWO_FACTOR_CODE_INVALID');
    }
  }

  private async acceptTotp(user: User, code: string): Promise<boolean> {
    const secret = decryptSecret(user.totpSecret!, this.secretKey);
    const step = verifyTotp(secret, code);
    if (step === null) return false;
    // Only a step later than the last one accepted, so a code seen over a
    // shoulder cannot be replayed within its 30 seconds.
    const { count } = await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return count === 1;
  }

  private async spendRecoveryCode(user: User, code: string): Promise<boolean> {
    const { count } = await this.prisma.twoFactorRecoveryCode.updateMany({
      where: { userId: user.id, codeHash: hashRecoveryCode(code), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 1) {
      const left = await this.prisma.twoFactorRecoveryCode.count({
        where: { userId: user.id, usedAt: null },
      });
      this.logger.warn({ userId: user.id, left }, 'Recovery code used');
    }
    return count === 1;
  }
}
