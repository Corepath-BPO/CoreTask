import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { AppConfigService } from '../../config/app-config.service';

import { MicrosoftGraphTransport } from './microsoft-graph.transport';

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

  constructor(
    private readonly config: AppConfigService,
    private readonly graph: MicrosoftGraphTransport,
  ) {}

  /**
   * Sends a message through whichever transport is configured.
   *
   * Microsoft Graph wins over SMTP when both are present: it is the deliberate,
   * explicitly-credentialed choice, whereas SMTP settings are easy to leave
   * pointing at a local catcher by accident. With neither, the log transport
   * writes the rendered message out — which keeps local development free of a
   * mail container while still exercising the whole
   * queue → processor → template → integration path.
   */
  async send(message: EmailMessage): Promise<void> {
    if (this.config.microsoftGraph.enabled) {
      await this.graph.send(message);
      return;
    }

    const { from, enabled } = this.config.smtp;

    if (!enabled) {
      this.logger.log(
        { to: message.to, subject: message.subject, body: message.text },
        'E-mail suppressed (no MICROSOFT_GRAPH_* or SMTP_HOST configured)',
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
