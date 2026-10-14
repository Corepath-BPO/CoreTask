import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectStarsController } from './project-stars.controller';
import { ProjectStarsService } from './project-stars.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule],
  controllers: [ProjectStarsController],
  providers: [ProjectStarsService],
})
export class ProjectStarsModule {}
