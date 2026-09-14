import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

import { AppConfigService } from '../../config/app-config.service';
import type { AutomationEvent } from '../../modules/automations/automation-event.publisher';
import {
  QueueName,
  WebhookJob,
  type RuleWebhookRequest,
  type WebhookDeliverJobData,
} from '../queue-names';

/**
 * Producer side of webhook delivery. Never throws: a webhook that fails to
 * enqueue must not fail the edit that raised it.
 *
 * Job ids make retries and duplicate publishes idempotent — BullMQ ignores an
 * add whose id already exists.
 */
@Injectable()
export class WebhookQueue {
  private readonly logger = new Logger(WebhookQueue.name);

  constructor(
    @InjectQueue(QueueName.WEBHOOK) private readonly queue: Queue,
    private readonly config: AppConfigService,
  ) {}

  /** One domain event, to be expanded into a delivery per subscribed endpoint. */
  async enqueueFanOut(event: AutomationEvent): Promise<void> {
    try {
      await this.queue.add(WebhookJob.FAN_OUT, event, {
        jobId: `fan-out-${event.eventId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      });
    } catch (error) {
      this.logger.error(
        { err: error, eventId: event.eventId, trigger: event.trigger },
        'Could not enqueue a webhook fan-out',
      );
    }
  }

  /** One HTTP delivery, retried with exponential backoff up to the configured attempts. */
  async enqueueDelivery(deliveryId: string, jobSuffix = ''): Promise<void> {
    const data: WebhookDeliverJobData = { deliveryId };

    try {
      await this.queue.add(WebhookJob.DELIVER, data, {
        jobId: `deliver-${deliveryId}${jobSuffix}`,
        attempts: this.config.webhooks.maxAttempts,
        backoff: { type: 'exponential', delay: this.config.webhooks.retryBaseDelayMs },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      });
    } catch (error) {
      this.logger.error({ err: error, deliveryId }, 'Could not enqueue a webhook delivery');
    }
  }

  /** A "Send a webhook" action's request; the id dedupes a re-run of the same rule on the same event. */
  async enqueueRuleSend(request: RuleWebhookRequest): Promise<void> {
    try {
      await this.queue.add(WebhookJob.RULE_SEND, request, {
        jobId: `rule-send-${request.sourceEventId}-${request.ruleId}-${request.nodeId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 3_600, count: 1_000 },
        removeOnFail: { age: 86_400 },
      });
    } catch (error) {
      this.logger.error(
        { err: error, ruleId: request.ruleId, nodeId: request.nodeId },
        'Could not enqueue a rule webhook',
      );
    }
  }
}
