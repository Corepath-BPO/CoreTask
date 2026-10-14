import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { AutomationEventsModule } from '../automations/automation-events.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectDependenciesController } from './project-dependencies.controller';
import { TaskRelationsController } from './task-relations.controller';
import { TaskRelationsService } from './task-relations.service';

/**
 * Task likes and dependencies. Depends on the tasks module to resolve a task
 * through the caller's view of it; nothing depends back, so no cycle.
 */
@Module({
  imports: [
    TasksModule,
    ActivityLogsModule,
    ProjectAccessModule,
    WorkspaceMembersModule,
    AutomationEventsModule,
  ],
  controllers: [TaskRelationsController, ProjectDependenciesController],
  providers: [TaskRelationsService],
})
export class TaskRelationsModule {}
