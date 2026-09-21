import { Module } from '@nestjs/common';

import { AutomationEventsModule } from '../automations/automation-events.module';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { FollowersModule } from '../followers/followers.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    AutomationEventsModule,
    WorkspaceMembersModule,
    ActivityLogsModule,
    NotificationsIntegrationModule,
    FollowersModule,
    ProjectAccessModule,
    // For the formula values the List reads off each row. Nothing in the
    // custom-fields module imports this one back.
    CustomFieldsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
