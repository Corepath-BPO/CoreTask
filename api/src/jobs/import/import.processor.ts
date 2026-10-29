import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue, RepeatOptions } from 'bullmq';

import { AppConfigService } from '../../config/app-config.service';
import { AsanaImporter } from '../../modules/asana-import/asana-importer.service';
import { AsanaLiveSyncService } from '../../modules/asana-import/asana-live-sync.service';
import { ImportJob, QueueName, type ImportJobData } from '../queue-names';

/**
 * Imports from other tools. One at a time: each is long, reads a whole
 * organisation, and shares one rate limit per token, so two in parallel would
 * each run at half speed and finish no sooner.
 *
 * Asana's live sync ticks on this queue too, for the same reason and one
 * more: one at a time means a tick never writes alongside a full run.
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
export class ImportProcessor extends WorkerHost implements OnApplicationBootstrap {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private readonly asana: AsanaImporter,
    private readonly live: AsanaLiveSyncService,
    private readonly config: AppConfigService,
    @InjectQueue(QueueName.IMPORT) private readonly queue: Queue,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    const { liveSyncIntervalMs, fullSyncCron, fullSyncTz } = this.config.asana;
    await this.schedule(ImportJob.ASANA_LIVE_SYNC, { every: liveSyncIntervalMs });
    await this.schedule(ImportJob.ASANA_NIGHTLY_SYNC, { pattern: fullSyncCron, tz: fullSyncTz });
  }

  async process(job: Job<ImportJobData>): Promise<unknown> {
    switch (job.name) {
      case ImportJob.ASANA:
        return { status: await this.asana.run(job.data.runId) };
      case ImportJob.ASANA_LIVE_SYNC:
        return this.live.tick();
      case ImportJob.ASANA_NIGHTLY_SYNC:
        return { workspaces: await this.live.requestNightlyRuns() };
      default:
        this.logger.warn({ name: job.name }, 'Unknown import job');
        return { skipped: true };
    }
  }

  /**
   * A schedule kept by name, so a changed interval or time replaces the old
   * one instead of running beside it.
   */
  private async schedule(name: ImportJob, repeat: Omit<RepeatOptions, 'key'>): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(name, repeat, {
        name,
        opts: { attempts: 1, removeOnComplete: { count: 20 }, removeOnFail: { age: 86_400 } },
      });
    } catch (error) {
      // A schedule that cannot be set must not stop the worker draining the queue.
      this.logger.error({ err: error, job: name }, 'Could not schedule an import job');
    }
  }
}
