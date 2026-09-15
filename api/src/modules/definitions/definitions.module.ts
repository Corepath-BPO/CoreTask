import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { PrioritiesController, ProjectStatusesController } from './definitions.controller';
import { DefinitionsService } from './definitions.service';

@Module({
  imports: [WorkspaceMembersModule, ProjectAccessModule, ProjectsModule],
  controllers: [ProjectStatusesController, PrioritiesController],
  providers: [DefinitionsService],
  exports: [DefinitionsService],
})
export class DefinitionsModule {}
