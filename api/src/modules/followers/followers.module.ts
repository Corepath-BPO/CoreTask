import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';

import { FollowersService } from './followers.service';

/**
 * The service alone — a leaf.
 *
 * Every module that writes a task, ticket or comment imports this to keep the
 * collaborators in step, so it must not import any of them back. The routes
 * live in `FollowersApiModule`, which may depend on whatever it likes.
 */
@Module({
  imports: [ActivityLogsModule],
  providers: [FollowersService],
  exports: [FollowersService],
})
export class FollowersModule {}
