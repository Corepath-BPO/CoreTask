import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { TaskTemplatesController } from './task-templates.controller';
import { TaskTemplatesService } from './task-templates.service';

@Module({
  imports: [TasksModule, ProjectAccessModule, WorkspaceMembersModule],
  controllers: [TaskTemplatesController],
  providers: [TaskTemplatesService],
})
export class TaskTemplatesModule {}
