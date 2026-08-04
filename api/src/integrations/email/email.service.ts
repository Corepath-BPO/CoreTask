import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { AppConfigService } from '../../config/app-config.service';

import { MicrosoftGraphTransport } from './microsoft-graph.transport';
import { isUndeliverableAddress } from './undeliverable-domains';

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
    if (!this.canReachRecipient(message)) return;

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

  /**
   * Refuses to open a real transport for an address that cannot receive mail.
   *
   * Two independent reasons, and either one alone justifies the check:
   *
   * - **Test runs must never send.** `NODE_ENV=test` means a suite is driving
   *   the app, and a suite that registers a few hundred users would otherwise
   *   emit a few hundred real messages.
   * - **Reserved domains are guaranteed bounces.** `@example.com` and anything
   *   under `.test` have no MX record by design, so every attempt produces a
   *   non-delivery report — and a burst of those is precisely the signal a mail
   *   provider reads as "this tenant is compromised", after which genuine mail
   *   starts getting throttled.
   *
   * Learned the hard way: enabling Graph in a development environment and then
   * running the e2e suites put 450 undeliverable messages through a real
   * mailbox in about ten minutes.
   */
  private canReachRecipient(message: EmailMessage): boolean {
    if (this.config.nodeEnv === 'test') {
      this.logger.debug({ to: message.to }, 'E-mail suppressed (test environment)');
      return false;
    }

    if (isUndeliverableAddress(message.to)) {
      this.logger.warn(
        { to: message.to, subject: message.subject },
        'E-mail suppressed (reserved domain — delivery is impossible and would only generate a bounce)',
      );
      return false;
    }

    return true;
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
