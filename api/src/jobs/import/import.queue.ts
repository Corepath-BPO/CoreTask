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
      /*
       * Re-running a failed run is still the user's call: `AsanaImporter`
       * records a failure on the run and returns, so the job completes.
       *
       * The job only throws when that record could not be written — the
       * worker shutting down mid-run, with the database already closed. The
       * run row is left RUNNING and nothing would ever pick it up again, so
       * the job is tried again a little later, by the worker that replaced
       * this one, and the run starts again from the top as it is built to.
       */
      attempts: 20,
      backoff: { type: 'fixed', delay: 30_000 },
      removeOnComplete: { age: 86_400, count: 100 },
      removeOnFail: { age: 7 * 86_400 },
    });
  }
}
