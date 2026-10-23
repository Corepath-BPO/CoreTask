import { createHash, randomBytes } from 'node:crypto';

import { EMAIL_CHANGE_RESEND_SECONDS, EMAIL_CHANGE_TTL_HOURS } from '@coretask/contracts';
import type {
  ConfirmEmailChangeResult,
  PendingEmailChange,
  RequestEmailChangePayload,
} from '@coretask/types';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { EmailQueue } from '../../jobs/email/email.queue';
import { UsersService } from '../users/users.service';

import { ReauthService } from './reauth.service';
import { SecurityNotices } from './security-notices';

/**
 * Moving an account to a new e-mail address.
 *
 * Asking needs the password (or what stands in for it); the move itself
 * happens only when the link sent to the *new* address is used, so nobody can
 * point an account at an inbox they cannot read. The old address is told
 * twice — when it is asked for and when it is done — since a hijacker's first
 * move is to change the address.
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly reauth: ReauthService,
    private readonly emailQueue: EmailQueue,
    private readonly notices: SecurityNotices,
  ) {}

  async pending(userId: string): Promise<PendingEmailChange | null> {
    const row = await this.prisma.emailChangeToken.findFirst({
      where: { userId, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { newEmail: true, expiresAt: true },
    });
    return row ? { email: row.newEmail, expiresAt: row.expiresAt.toISOString() } : null;
  }

  async request(
    userId: string,
    sessionId: string | null,
    input: RequestEmailChangePayload,
  ): Promise<PendingEmailChange> {
    const user = await this.reauth.assert(userId, sessionId, input);
    const email = UsersService.normalizeEmail(input.email);

    if (email === user.email) {
      throw AppException.badRequest('BAD_REQUEST', 'That is already your e-mail address.');
    }
    if (await this.users.findByEmail(email)) {
      throw AppException.conflict('EMAIL_ALREADY_REGISTERED');
    }

    const recent = await this.prisma.emailChangeToken.findFirst({
      where: {
        userId,
        createdAt: { gt: new Date(Date.now() - EMAIL_CHANGE_RESEND_SECONDS * 1_000) },
      },
      select: { id: true },
    });
    if (recent) {
      throw new AppException(
        'RATE_LIMIT_EXCEEDED',
        HttpStatus.TOO_MANY_REQUESTS,
        'A link went out under a minute ago. Wait a moment before asking again.',
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_HOURS * 3_600_000);
    await this.prisma.$transaction([
      this.prisma.emailChangeToken.deleteMany({ where: { userId, usedAt: null } }),
      this.prisma.emailChangeToken.create({
        data: { userId, newEmail: email, tokenHash: hashToken(token), expiresAt },
      }),
    ]);

    await this.emailQueue.enqueueEmailChange({
      userId,
      email,
      name: user.name,
      token,
      expiresAt: expiresAt.toISOString(),
    });
    await this.notices.send(userId, {
      subject: 'Someone asked to change your CoreTask e-mail address',
      heading: 'A new e-mail address was requested',
      lines: [
        `Someone signed in to your account asked to move it to ${email}.`,
        'Nothing changes unless the link sent to that address is used within a day.',
      ],
    });
    this.logger.log({ userId }, 'E-mail change requested');
    return { email, expiresAt: expiresAt.toISOString() };
  }

  async cancel(userId: string): Promise<void> {
    await this.prisma.emailChangeToken.deleteMany({ where: { userId, usedAt: null } });
  }

  /**
   * Public, since the link may be opened on a device that is not signed in.
   * The link carries all the authority: it was sent to the new address, by a
   * request the old password made.
   */
  async confirm(token: string): Promise<ConfirmEmailChangeResult> {
    const row = await this.prisma.emailChangeToken.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        newEmail: true,
        usedAt: true,
        expiresAt: true,
        user: { select: { id: true, email: true, name: true, isActive: true, deletedAt: true } },
      },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt.getTime() <= Date.now() ||
      !row.user.isActive ||
      row.user.deletedAt
    ) {
      throw AppException.badRequest('EMAIL_CHANGE_INVALID');
    }

    const claimed = await this.prisma.emailChangeToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (claimed.count === 0) throw AppException.badRequest('EMAIL_CHANGE_INVALID');

    const previous = { email: row.user.email, name: row.user.name };
    try {
      await this.prisma.$transaction([
        this.prisma.user.update({
          where: { id: row.user.id },
          data: {
            email: row.newEmail,
            // The link reached the new inbox, which is what confirming means.
            emailVerifiedAt: new Date(),
            emailVerificationDueAt: null,
          },
        }),
        this.prisma.emailChangeToken.deleteMany({
          where: { userId: row.user.id, id: { not: row.id } },
        }),
        // Links mailed to the old address must not outlive it.
        this.prisma.emailVerificationToken.deleteMany({ where: { userId: row.user.id } }),
        this.prisma.passwordResetToken.deleteMany({
          where: { userId: row.user.id, usedAt: null },
        }),
      ]);
    } catch (error) {
      // Someone registered the address between the request and the click.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppException.conflict('EMAIL_ALREADY_REGISTERED');
      }
      throw error;
    }

    await this.notices.send(row.user.id, {
      to: previous,
      subject: 'Your CoreTask e-mail address was changed',
      heading: 'Your e-mail address was changed',
      lines: [
        `Your CoreTask account now signs in with ${row.newEmail} instead of this address.`,
        'Mail about your account goes there from now on.',
      ],
    });
    this.logger.log({ userId: row.user.id }, 'E-mail address changed');
    return { email: row.newEmail };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
