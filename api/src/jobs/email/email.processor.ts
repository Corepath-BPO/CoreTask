import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AppConfigService } from '../../config/app-config.service';
import { EmailService } from '../../integrations/email/email.service';
import {
  emailChangeEmail,
  emailVerificationEmail,
  invitationEmail,
  passwordResetEmail,
} from '../../integrations/email/email.templates';
import {
  EmailJob,
  QueueName,
  type EmailChangeJobData,
  type EmailJobData,
  type EmailVerificationJobData,
  type InvitationEmailJobData,
  type MessageEmailJobData,
  type PasswordResetEmailJobData,
} from '../queue-names';

/**
 * Consumer for the e-mail queue. Registered only in `WorkerModule`, so the API
 * process produces jobs and the worker process drains them.
 */
@Processor(QueueName.EMAIL, { concurrency: 5 })
export class EmailProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private readonly email: EmailService,
    private readonly config: AppConfigService,
  ) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    switch (job.name) {
      case EmailJob.EMAIL_VERIFICATION: {
        const data = job.data as EmailVerificationJobData;
        await this.email.send(
          emailVerificationEmail({
            to: data.email,
            name: data.name,
            token: data.token,
            expiresAt: data.expiresAt,
            webUrl: this.config.http.webUrl,
            welcome: data.welcome,
          }),
        );
        return;
      }

      case EmailJob.INVITATION: {
        const data = job.data as InvitationEmailJobData;
        await this.email.send(
          invitationEmail({
            to: data.email,
            token: data.token,
            workspaceName: data.workspaceName,
            invitedByName: data.invitedByName,
            role: data.role,
            teamName: data.teamName,
            // Absent on a job queued before projects could be named.
            projectName: data.projectName ?? null,
            expiresAt: data.expiresAt,
            webUrl: this.config.http.webUrl,
          }),
        );
        return;
      }

      case EmailJob.MESSAGE: {
        await this.email.send(job.data as MessageEmailJobData);
        return;
      }

      case EmailJob.PASSWORD_RESET: {
        const data = job.data as PasswordResetEmailJobData;
        await this.email.send(
          passwordResetEmail({
            to: data.email,
            name: data.name,
            token: data.token,
            expiresAt: data.expiresAt,
            webUrl: this.config.http.webUrl,
          }),
        );
        return;
      }
      case EmailJob.EMAIL_CHANGE: {
        const data = job.data as EmailChangeJobData;
        await this.email.send(
          emailChangeEmail({
            to: data.email,
            name: data.name,
            token: data.token,
            expiresAt: data.expiresAt,
            webUrl: this.config.http.webUrl,
          }),
        );
        return;
      }
      default:
        // Unknown names are dropped rather than retried forever — they mean a
        // producer was deployed ahead of this worker.
        this.logger.warn({ jobName: job.name, jobId: job.id }, 'Discarding unknown e-mail job');
    }
  }
}
