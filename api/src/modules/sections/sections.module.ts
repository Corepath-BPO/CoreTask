import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { SectionsController } from './sections.controller';
import { SectionsService } from './sections.service';

@Module({
  imports: [WorkspaceMembersModule, ProjectsModule, ActivityLogsModule],
  controllers: [SectionsController],
  providers: [SectionsService],
  exports: [SectionsService],
})
export class SectionsModule {}
