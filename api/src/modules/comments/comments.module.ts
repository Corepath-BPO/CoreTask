import { Module } from '@nestjs/common';

import { NotificationsIntegrationModule } from '../../integrations/notifications/notifications-integration.module';
import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { TasksModule } from '../tasks/tasks.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import {
  CommentsController,
  TaskCommentsController,
  TicketCommentsController,
} from './comments.controller';
import { CommentsService } from './comments.service';

@Module({
  // Tasks and tickets are imported for their parent lookups, which is what keeps
  // comment routes tenant-scoped without duplicating the rule.
  imports: [
    WorkspaceMembersModule,
    ActivityLogsModule,
    NotificationsIntegrationModule,
    TasksModule,
    TicketsModule,
  ],
  controllers: [TaskCommentsController, TicketCommentsController, CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}
