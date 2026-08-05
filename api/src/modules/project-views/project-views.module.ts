import { Module } from '@nestjs/common';

import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { DefinitionsModule } from '../definitions/definitions.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { FieldCatalogService } from './field-catalog.service';
import { FieldMetadataService } from './field-metadata.service';
import { ProjectTasksController } from './project-tasks.controller';
import { ProjectViewsController } from './project-views.controller';
import { ProjectViewsService } from './project-views.service';

@Module({
  // Projects is imported for `requireProject`, which is what keeps view routes
  // tenant-scoped without restating the rule.
  imports: [
    WorkspaceMembersModule,
    ProjectsModule,
    TasksModule,
    CustomFieldsModule,
    DefinitionsModule,
  ],
  controllers: [ProjectViewsController, ProjectTasksController],
  providers: [FieldCatalogService, ProjectViewsService, FieldMetadataService],
  exports: [ProjectViewsService, FieldMetadataService],
})
export class ProjectViewsModule {}
