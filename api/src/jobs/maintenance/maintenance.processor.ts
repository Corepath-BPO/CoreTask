import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue, type Job } from 'bullmq';

import { AttachmentSweeperService } from '../../modules/attachments/attachment-sweeper.service';
import { MaintenanceJob, QueueName } from '../queue-names';

/** How often the sweep runs. Hourly is ample for tidying abandoned uploads. */
const SWEEP_INTERVAL_MS = 60 * 60_000;

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
    @InjectQueue(QueueName.MAINTENANCE) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.queue.add(
        MaintenanceJob.SWEEP_ABANDONED_UPLOADS,
        {},
        {
          repeat: { every: SWEEP_INTERVAL_MS },
          // A stable id means restarting the worker re-uses the schedule rather
          // than stacking a second copy of it.
          jobId: MaintenanceJob.SWEEP_ABANDONED_UPLOADS,
          removeOnComplete: { count: 20 },
          removeOnFail: { age: 86_400 },
        },
      );
    } catch (error) {
      // Housekeeping failing to schedule must not stop the worker from starting
      // and draining the queues that actually matter to users.
      this.logger.error({ err: error }, 'Could not schedule the maintenance sweep');
    }
  }

  async process(job: Job): Promise<unknown> {
    if (job.name !== MaintenanceJob.SWEEP_ABANDONED_UPLOADS) {
      this.logger.warn({ name: job.name }, 'Unknown maintenance job');
      return { skipped: true };
    }

    return this.sweeper.sweepAbandonedUploads();
  }
}
