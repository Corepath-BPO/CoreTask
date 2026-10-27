import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { ImportJob, QueueName, type ImportJobData } from '../queue-names';

/**
 * Producer side of imports. One job per run, keyed by the run, so a double
 * click enqueues it once.
 *
 * Unlike e-mail or webhooks this throws when it cannot enqueue: the run row
 * already exists, and saying "started" when nothing will pick it up would
 * leave it queued forever.
 */
@Injectable()
export class ImportQueue {
  constructor(@InjectQueue(QueueName.IMPORT) private readonly queue: Queue) {}

  async enqueueAsana(runId: string): Promise<void> {
    const data: ImportJobData = { runId };
    await this.queue.add(ImportJob.ASANA, data, {
      jobId: `asana-${runId}`,
      // Re-running is the user's call: a run that failed half way is finished
      // by starting another, which picks up where the rows already are.
      attempts: 1,
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 7 * 86_400 },
    });
  }
}
