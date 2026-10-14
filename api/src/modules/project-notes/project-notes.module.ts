import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectNotesController } from './project-notes.controller';
import { ProjectNotesService } from './project-notes.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule],
  controllers: [ProjectNotesController],
  providers: [ProjectNotesService],
})
export class ProjectNotesModule {}
