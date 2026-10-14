import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectAppsController } from './project-apps.controller';
import { ProjectAppsService } from './project-apps.service';
import { WebhookDeliveryModule } from './webhook-delivery.module';
import { WebhookDeliveriesController, WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [WorkspaceMembersModule, ActivityLogsModule, WebhookDeliveryModule, ProjectAccessModule],
  controllers: [WebhooksController, WebhookDeliveriesController, ProjectAppsController],
  providers: [WebhooksService, ProjectAppsService],
})
export class WebhooksModule {}
