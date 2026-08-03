import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

@Module({
  imports: [WorkspaceMembersModule, ActivityLogsModule, NotificationsIntegrationModule],
  controllers: [WorkspacesController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
