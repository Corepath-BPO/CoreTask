import { Module } from '@nestjs/common';

import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationGraphValidatorService } from './builder/automation-graph-validator.service';
import { AutomationMetadataService } from './builder/automation-metadata.service';
import { AutomationDefinitionService } from './structured/automation-definition.service';

@Module({
  imports: [WorkspaceMembersModule, ProjectsModule],
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    AutomationGraphValidatorService,
    AutomationMetadataService,
    AutomationDefinitionService,
  ],
  exports: [AutomationsService],
})
export class AutomationsModule {}
