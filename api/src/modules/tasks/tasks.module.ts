import { Module } from '@nestjs/common';

import { AutomationEventsModule } from '../automations/automation-events.module';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    AutomationEventsModule,WorkspaceMembersModule, ActivityLogsModule, NotificationsIntegrationModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
