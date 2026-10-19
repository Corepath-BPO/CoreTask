import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectResourcesController } from './project-resources.controller';
import { ProjectResourcesService } from './project-resources.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule],
  controllers: [ProjectResourcesController],
  providers: [ProjectResourcesService],
})
export class ProjectResourcesModule {}
