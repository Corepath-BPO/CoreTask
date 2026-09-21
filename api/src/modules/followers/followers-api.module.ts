import { Module } from '@nestjs/common';

import { TasksModule } from '../tasks/tasks.module';
import { TicketsModule } from '../tickets/tickets.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { TaskFollowersController, TicketFollowersController } from './followers.controller';
import { FollowersModule } from './followers.module';

/**
 * The routes, kept apart from the service so resolving a parent through the
 * task and ticket services does not close a cycle back into the leaf every
 * write path imports.
 */
@Module({
  imports: [FollowersModule, TasksModule, TicketsModule, WorkspaceMembersModule],
  controllers: [TaskFollowersController, TicketFollowersController],
})
export class FollowersApiModule {}
