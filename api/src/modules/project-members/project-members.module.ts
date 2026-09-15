import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectMembersController } from './project-members.controller';
import { ProjectMembersService } from './project-members.service';

/**
 * Separate from `ProjectsModule` for the reason `MembersModule` is separate
 * from `WorkspaceMembersModule`: it needs activity, notifications and the
 * gateway, and nothing must import it back. A leaf, so it may depend on
 * whatever it likes.
 */
@Module({
  imports: [
    WorkspaceMembersModule,
    ProjectAccessModule,
    ActivityLogsModule,
    NotificationsIntegrationModule,
  ],
  controllers: [ProjectMembersController],
  providers: [ProjectMembersService],
})
export class ProjectMembersModule {}
