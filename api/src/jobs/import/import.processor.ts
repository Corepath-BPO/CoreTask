import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { AsanaImporter } from '../../modules/asana-import/asana-importer.service';
import { ImportJob, QueueName, type ImportJobData } from '../queue-names';

/**
 * Imports from other tools. One at a time: each is long, reads a whole
 * organisation, and shares one rate limit per token, so two in parallel would
 * each run at half speed and finish no sooner.
 *
 * The lock is generous because a run holds the job for an hour or more;
 * BullMQ renews it on a timer as long as the event loop turns, which an
 * import that waits on Asana and the database always lets it do.
 *
 * A worker that restarts mid-run — a deploy — leaves the job stalled, and
 * BullMQ hands it to the next worker. Its default gives up after one such
 * hand-over; a run is safe to repeat (it updates what it already wrote), so
 * an import is handed over as often as the worker restarts, within reason.
 */
@Processor(QueueName.IMPORT, { concurrency: 1, lockDuration: 120_000, maxStalledCount: 20 })
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(private readonly asana: AsanaImporter) {
    super();
  }

  async process(job: Job<ImportJobData>): Promise<unknown> {
    switch (job.name) {
      case ImportJob.ASANA:
        return { status: await this.asana.run(job.data.runId) };
      default:
        this.logger.warn({ name: job.name }, 'Unknown import job');
        return { skipped: true };
    }
  }
}
