import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import type { AutomationEvent } from '../../modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../modules/automations/automation-runner.service';
import { QueueName } from '../queue-names';

/**
 * Drains automation events.
 *
 * Concurrency is deliberately low. Two rules acting on the same task at once
 * produce a last-write-wins race that is invisible in the logs, and automation
 * is not latency-sensitive — a second's delay goes unnoticed where a lost
 * update does not.
 */
@Processor(QueueName.AUTOMATION, { concurrency: 2 })
export class AutomationProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationProcessor.name);

  constructor(private readonly runner: AutomationRunnerService) {
    super();
  }

  async process(job: Job<AutomationEvent>): Promise<unknown> {
    const event = job.data;
    const result = await this.runner.handle(event);

    if (result.executed > 0) {
      this.logger.log(
        {
          trigger: event.trigger,
          correlationId: event.correlationId,
          depth: event.depth,
          ...result,
        },
        'Automation rules executed',
      );
    }

    return result;
  }
}
