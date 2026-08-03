import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { InvitationsController, WorkspaceInvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [WorkspaceMembersModule, ActivityLogsModule, NotificationsIntegrationModule],
  controllers: [WorkspaceInvitationsController, InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
