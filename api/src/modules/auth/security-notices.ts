import { Injectable, Logger } from '@nestjs/common';

import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { securityNoticeEmail } from '../../integrations/email/email.templates';
import { EmailQueue } from '../../jobs/email/email.queue';

/**
 * "Something changed about how your account is protected" e-mails: two-step
 * verification on or off, a new address, the account deleted.
 *
 * Written here and queued ready to send, as notification e-mails are. Never
 * throws — the change itself has already happened, and losing the notice must
 * not make it look as if it had not.
 */
@Injectable()
export class SecurityNotices {
  private readonly logger = new Logger(SecurityNotices.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailQueue: EmailQueue,
    private readonly config: AppConfigService,
  ) {}

  /**
   * To the account's address as it is now, unless `to` names another — the
   * old address after a change, or the address an account had before it was
   * deleted and scrubbed.
   */
  async send(
    userId: string,
    notice: {
      subject: string;
      heading: string;
      lines: string[];
      to?: { email: string; name: string };
      showSettingsLink?: boolean;
    },
  ): Promise<void> {
    try {
      const recipient =
        notice.to ??
        (await this.prisma.user.findUnique({
          where: { id: userId },
          select: { email: true, name: true, isServiceAccount: true },
        }));
      if (!recipient || ('isServiceAccount' in recipient && recipient.isServiceAccount)) return;

      const message = securityNoticeEmail({
        to: recipient.email,
        name: recipient.name,
        subject: notice.subject,
        heading: notice.heading,
        lines: notice.lines,
        webUrl: this.config.webOrigin,
        ...(notice.showSettingsLink === undefined
          ? {}
          : { showSettingsLink: notice.showSettingsLink }),
      });
      await this.emailQueue.enqueueMessage({
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      });
    } catch (error) {
      this.logger.error({ err: error, userId }, 'Could not queue a security notice');
    }
  }
}
