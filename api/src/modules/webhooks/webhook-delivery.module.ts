import { Module } from '@nestjs/common';

import { SlackClientModule } from '../../integrations/slack/slack.module';
import { ProjectAccessModule } from '../project-access/project-access.module';

import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookPayloadBuilder } from './webhook-payload.builder';

/**
 * The delivery engine, with almost nothing attached.
 *
 * Prisma, configuration and the queue — all global — and Slack's client, for
 * the apps that post as the CoreTask bot. So the worker can register it
 * without pulling in the request-side webhooks module, and the API can
 * import it to queue a test delivery.
 */
@Module({
  imports: [ProjectAccessModule, SlackClientModule],
  providers: [WebhookDeliveryService, WebhookPayloadBuilder],
  exports: [WebhookDeliveryService],
})
export class WebhookDeliveryModule {}
