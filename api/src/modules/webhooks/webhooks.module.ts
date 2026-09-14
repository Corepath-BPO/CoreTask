import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { WebhookDeliveryModule } from './webhook-delivery.module';
import { WebhookDeliveriesController, WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [WorkspaceMembersModule, ActivityLogsModule, WebhookDeliveryModule],
  controllers: [WebhooksController, WebhookDeliveriesController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
