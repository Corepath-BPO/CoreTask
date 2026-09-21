import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';

import { AttachmentSweeperService } from '../../modules/attachments/attachment-sweeper.service';
import { WebhookDeliveryService } from '../../modules/webhooks/webhook-delivery.service';
import { MaintenanceJob, QueueName } from '../queue-names';

/** How often the sweep runs. Hourly is ample for tidying abandoned uploads. */
const SWEEP_INTERVAL_MS = 60 * 60_000;
/** Delivery records age out by the day, so a daily purge keeps up with them. */
const PURGE_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * Periodic housekeeping the request path should not be doing.
 *
 * The schedule is registered here rather than in the API module on purpose: a
 * repeatable job added by every API replica would be the same job re-registered
 * N times, whereas BullMQ keys a repeatable by name and options, so registering
 * it from the single worker keeps exactly one.
 */
@Processor(QueueName.MAINTENANCE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceProcessor.name);

  constructor(
    private readonly sweeper: AttachmentSweeperService,
    private readonly webhookDeliveries: WebhookDeliveryService,
    @InjectQueue(QueueName.MAINTENANCE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.schedule(MaintenanceJob.SWEEP_ABANDONED_UPLOADS, SWEEP_INTERVAL_MS);
    await this.schedule(MaintenanceJob.PURGE_WEBHOOK_DELIVERIES, PURGE_INTERVAL_MS);
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case MaintenanceJob.SWEEP_ABANDONED_UPLOADS:
        return this.sweeper.sweepAbandonedUploads();
      case MaintenanceJob.PURGE_WEBHOOK_DELIVERIES:
        return this.webhookDeliveries.purgeExpired();
      default:
        this.logger.warn({ name: job.name }, 'Unknown maintenance job');
        return { skipped: true };
    }
  }

  private async schedule(name: MaintenanceJob, everyMs: number): Promise<void> {
    try {
      await this.queue.add(
        name,
        {},
        {
          repeat: { every: everyMs },
          // A stable id means restarting the worker re-uses the schedule rather
          // than stacking a second copy of it.
          jobId: name,
          removeOnComplete: { count: 20 },
          removeOnFail: { age: 86_400 },
        },
      );
    } catch (error) {
      // Housekeeping failing to schedule must not stop the worker from starting
      // and draining the queues that actually matter to users.
      this.logger.error({ err: error, job: name }, 'Could not schedule a maintenance job');
    }
  }
}
