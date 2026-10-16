import { Module } from '@nestjs/common';

import { SlackClientModule } from '../../integrations/slack/slack.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectAppsController } from './project-apps.controller';
import { ProjectAppsService } from './project-apps.service';
import { WebhookDeliveryModule } from './webhook-delivery.module';
import { WebhookSubscriptionsController } from './webhook-subscriptions.controller';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { WebhookDeliveriesController, WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    WorkspaceMembersModule,
    ActivityLogsModule,
    WebhookDeliveryModule,
    ProjectAccessModule,
    SlackClientModule,
  ],
  controllers: [
    WebhooksController,
    WebhookDeliveriesController,
    ProjectAppsController,
    WebhookSubscriptionsController,
  ],
  providers: [WebhooksService, ProjectAppsService, WebhookSubscriptionsService],
})
export class WebhooksModule {}
