import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { PrioritiesController, ProjectStatusesController } from './definitions.controller';
import { DefinitionsService } from './definitions.service';

@Module({
  imports: [WorkspaceMembersModule, ProjectsModule],
  controllers: [ProjectStatusesController, PrioritiesController],
  providers: [DefinitionsService],
  exports: [DefinitionsService],
})
export class DefinitionsModule {}
