import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { AutomationsModule } from '../automations/automations.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { ProjectsModule } from '../projects/projects.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectBlueprintService } from './project-blueprint.service';
import { ProjectTemplatesController } from './project-templates.controller';
import { ProjectTemplatesService } from './project-templates.service';

@Module({
  imports: [
    ActivityLogsModule,
    AutomationsModule,
    CustomFieldsModule,
    ProjectAccessModule,
    ProjectsModule,
    WorkspaceMembersModule,
  ],
  controllers: [ProjectTemplatesController],
  providers: [ProjectBlueprintService, ProjectTemplatesService],
})
export class ProjectTemplatesModule {}
