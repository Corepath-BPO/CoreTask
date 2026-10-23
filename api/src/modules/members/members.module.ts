import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { WebsocketModule } from '../../websocket/websocket.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { MembersController } from './members.controller';
import { MembersService } from './members.service';

/**
 * Nearly a leaf: only account deletion imports this, to leave workspaces the
 * way "leave" does, and nothing imports that. So it can depend on
 * notifications without closing a cycle back through the guard every other
 * module needs.
 */
@Module({
  imports: [
    WorkspaceMembersModule,
    ActivityLogsModule,
    NotificationsIntegrationModule,
    WebsocketModule,
  ],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
