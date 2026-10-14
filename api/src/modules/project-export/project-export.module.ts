import { Module } from '@nestjs/common';

import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ProjectExportController } from './project-export.controller';
import { ProjectExportService } from './project-export.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule, CustomFieldsModule],
  controllers: [ProjectExportController],
  providers: [ProjectExportService],
})
export class ProjectExportModule {}
