import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import type { AutomationEvent } from '../../modules/automations/automation-event.publisher';
import { WebhookDeliveryService } from '../../modules/webhooks/webhook-delivery.service';
import {
  QueueName,
  WebhookJob,
  type RuleWebhookRequest,
  type WebhookDeliverJobData,
} from '../queue-names';

/**
 * Drains the webhook queue.
 *
 * Higher concurrency than automations: deliveries are IO-bound waits on other
 * people's servers and touch nothing that races. A slow endpoint occupies one
 * slot, not the queue.
 */
@Processor(QueueName.WEBHOOK, { concurrency: 10 })
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(private readonly deliveries: WebhookDeliveryService) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case WebhookJob.FAN_OUT:
        return this.deliveries.fanOut(job.data as AutomationEvent);
      case WebhookJob.DELIVER:
        return this.deliveries.deliver(
          (job.data as WebhookDeliverJobData).deliveryId,
          job.attemptsMade + 1,
        );
      case WebhookJob.RULE_SEND:
        return this.deliveries.ruleSend(job.data as RuleWebhookRequest);
      default:
        this.logger.warn({ name: job.name }, 'Unknown webhook job');
        return { skipped: true };
    }
  }
}
