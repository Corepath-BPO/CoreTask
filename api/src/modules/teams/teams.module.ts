import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { TeamMessagesController } from './team-messages.controller';
import { TeamMessagesService } from './team-messages.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [
    WorkspaceMembersModule,
    ActivityLogsModule,
    ProjectAccessModule,
    NotificationsIntegrationModule,
  ],
  controllers: [TeamsController, TeamMessagesController],
  providers: [TeamsService, TeamMessagesService],
})
export class TeamsModule {}
