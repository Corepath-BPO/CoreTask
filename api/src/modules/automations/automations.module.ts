import { Module } from '@nestjs/common';

import { AiModule } from '../../integrations/ai/ai.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { AutomationDraftService } from './automation-draft.service';
import { AutomationEventsModule } from './automation-events.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { AutomationGraphValidatorService } from './builder/automation-graph-validator.service';
import { AutomationMetadataService } from './builder/automation-metadata.service';
import { AutomationTemplatesController } from './library/automation-templates.controller';
import { AutomationTemplatesService } from './library/automation-templates.service';
import { AutomationDefinitionService } from './structured/automation-definition.service';

@Module({
  imports: [
    WorkspaceMembersModule,
    ProjectAccessModule,
    ProjectsModule,
    AutomationEventsModule,
    AiModule,
  ],
  controllers: [AutomationsController, AutomationTemplatesController],
  providers: [
    AutomationsService,
    AutomationDraftService,
    AutomationGraphValidatorService,
    AutomationMetadataService,
    AutomationDefinitionService,
    AutomationTemplatesService,
  ],
  exports: [AutomationsService, AutomationTemplatesService],
})
export class AutomationsModule {}
