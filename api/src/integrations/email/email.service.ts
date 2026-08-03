import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { AppConfigService } from '../../config/app-config.service';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;

  constructor(private readonly config: AppConfigService) {}

  /**
   * Sends a message through SMTP, or logs it when no SMTP host is configured.
   *
   * The log transport keeps local development free of a mail container while
   * still exercising the full queue -> processor -> integration path.
   */
  async send(message: EmailMessage): Promise<void> {
    const { from, enabled } = this.config.smtp;

    if (!enabled) {
      this.logger.log(
        { to: message.to, subject: message.subject, body: message.text },
        'E-mail suppressed (SMTP_HOST is not configured)',
      );
      return;
    }

    const transporter = (this.transporter ??= this.createTransporter());
    await transporter.sendMail({ from, ...message });
    this.logger.log({ to: message.to, subject: message.subject }, 'E-mail sent');
  }

  private createTransporter(): Transporter {
    const { host, port, user, password, secure } = this.config.smtp;

    return createTransport({
      host,
      port,
      secure,
      ...(user ? { auth: { user, pass: password ?? '' } } : {}),
    });
  }
}
