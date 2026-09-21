import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  AutomationEventPublisher,
  type AutomationEvent,
} from '../../modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../modules/automations/automation-runner.service';
import { QueueName } from '../queue-names';
import { WebhookQueue } from '../webhook/webhook.queue';

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

  constructor(
    private readonly runner: AutomationRunnerService,
    private readonly publisher: AutomationEventPublisher,
    private readonly webhooks: WebhookQueue,
  ) {
    super();
  }

  async process(job: Job<AutomationEvent>): Promise<unknown> {
    const event = job.data;
    const result = await this.runner.handle(event);

    /*
     * The chain continues here, not in the runner.
     *
     * Every change a rule made is announced the way a person's change is, so
     * a rule listening for it runs — "when the field changes, move it" and
     * "when it arrives, add the checklist" only work together if the first
     * rule's move is an event the second can hear. Published once the run is
     * over rather than action by action: the runner holds no queue, and a run
     * that failed part-way has published nothing rather than half a chain.
     *
     * Each event already carries the rule that caused it and a depth one
     * greater, which is what the runner's guards read on the next hop. The
     * publisher never throws, so one event failing to enqueue does not lose
     * the rest.
     */
    for (const next of result.events) {
      await this.publisher.publish(next);
    }

    // The same arrangement for "Send a webhook" actions: the runner says what
    // it wants sent, and the request goes onto the webhook queue from here.
    for (const request of result.webhooks) {
      await this.webhooks.enqueueRuleSend(request);
    }

    if (result.executed > 0) {
      this.logger.log(
        {
          trigger: event.trigger,
          correlationId: event.correlationId,
          depth: event.depth,
          executed: result.executed,
          skipped: result.skipped,
          published: result.events.length,
          webhooks: result.webhooks.length,
        },
        'Automation rules executed',
      );
    }

    // Counts only: the return value is kept on the job in Redis, and a list of
    // events that are already in the queue would be stored twice for nothing.
    return {
      executed: result.executed,
      skipped: result.skipped,
      published: result.events.length,
      webhooks: result.webhooks.length,
    };
  }
}
