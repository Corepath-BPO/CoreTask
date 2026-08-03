import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AppConfigService } from '../../config/app-config.service';
import { EmailService } from '../../integrations/email/email.service';
import { invitationEmail, welcomeEmail } from '../../integrations/email/email.templates';
import {
  EmailJob,
  QueueName,
  type EmailJobData,
  type InvitationEmailJobData,
  type WelcomeEmailJobData,
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
      case EmailJob.WELCOME: {
        const data = job.data as WelcomeEmailJobData;
        await this.email.send(
          welcomeEmail({
            to: data.email,
            name: data.name,
            webUrl: this.config.http.webUrl,
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
