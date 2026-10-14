import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { TagsController, TaskTagsController } from './tags.controller';
import { TagsService } from './tags.service';

@Module({
  imports: [TasksModule, ActivityLogsModule, WorkspaceMembersModule],
  controllers: [TagsController, TaskTagsController],
  providers: [TagsService],
})
export class TagsModule {}
