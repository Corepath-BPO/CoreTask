import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

@Module({
  imports: [WorkspaceMembersModule, ProjectsModule],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
