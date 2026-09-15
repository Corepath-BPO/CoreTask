import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationGraphValidatorService } from './builder/automation-graph-validator.service';
import { AutomationMetadataService } from './builder/automation-metadata.service';
import { AutomationTemplatesController } from './library/automation-templates.controller';
import { AutomationTemplatesService } from './library/automation-templates.service';
import { AutomationDefinitionService } from './structured/automation-definition.service';

@Module({
  imports: [WorkspaceMembersModule, ProjectAccessModule, ProjectsModule],
  controllers: [AutomationsController, AutomationTemplatesController],
  providers: [
    AutomationsService,
    AutomationGraphValidatorService,
    AutomationMetadataService,
    AutomationDefinitionService,
    AutomationTemplatesService,
  ],
  exports: [AutomationsService],
})
export class AutomationsModule {}
