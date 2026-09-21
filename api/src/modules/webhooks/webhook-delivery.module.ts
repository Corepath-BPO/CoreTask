import { Module } from '@nestjs/common';

import { WebhookDeliveryService } from './webhook-delivery.service';
import { WebhookPayloadBuilder } from './webhook-payload.builder';

/**
 * The delivery engine, with almost nothing attached.
 *
 * Prisma, configuration and the queue — all global — so the worker can register
 * it without pulling in the request-side webhooks module, and the API can
 * import it to queue a test delivery.
 */
@Module({
  providers: [WebhookDeliveryService, WebhookPayloadBuilder],
  exports: [WebhookDeliveryService],
})
export class WebhookDeliveryModule {}
