import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectViewsController } from './project-views.controller';
import { ProjectViewsService } from './project-views.service';

@Module({
  // Projects is imported for `requireProject`, which is what keeps view routes
  // tenant-scoped without restating the rule.
  imports: [WorkspaceMembersModule, ProjectsModule],
  controllers: [ProjectViewsController],
  providers: [ProjectViewsService],
  exports: [ProjectViewsService],
})
export class ProjectViewsModule {}
