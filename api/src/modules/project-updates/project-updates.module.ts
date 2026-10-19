import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WebhookDeliveryModule } from '../webhooks/webhook-delivery.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectUpdatesController } from './project-updates.controller';
import { ProjectUpdatesService } from './project-updates.service';

@Module({
  imports: [
    ProjectAccessModule,
    WebhookDeliveryModule,
    WorkspaceMembersModule,
    ActivityLogsModule,
    NotificationsIntegrationModule,
  ],
  controllers: [ProjectUpdatesController],
  providers: [ProjectUpdatesService],
})
export class ProjectUpdatesModule {}
