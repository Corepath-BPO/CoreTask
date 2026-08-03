import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AppConfigService } from '../../config/app-config.service';
import { EmailService } from '../../integrations/email/email.service';
import { welcomeEmail } from '../../integrations/email/email.templates';
import { EmailJob, QueueName, type WelcomeEmailJobData } from '../queue-names';

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

  async process(job: Job<WelcomeEmailJobData>): Promise<void> {
    switch (job.name) {
      case EmailJob.WELCOME:
        await this.email.send(
          welcomeEmail({
            to: job.data.email,
            name: job.data.name,
            webUrl: this.config.http.webUrl,
          }),
        );
        return;
      default:
        // Unknown names are dropped rather than retried forever — they mean a
        // producer was deployed ahead of this worker.
        this.logger.warn({ jobName: job.name, jobId: job.id }, 'Discarding unknown e-mail job');
    }
  }
}
