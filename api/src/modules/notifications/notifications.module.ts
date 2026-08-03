import { Module } from '@nestjs/common';

import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [WorkspaceMembersModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
