import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { MembersController } from './members.controller';
import { MembersService } from './members.service';

/**
 * A leaf: nothing imports this, so it can depend on notifications without
 * closing a cycle back through the guard every other module needs.
 */
@Module({
  imports: [WorkspaceMembersModule, ActivityLogsModule, NotificationsIntegrationModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
