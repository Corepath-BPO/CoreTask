import { Module } from '@nestjs/common';

import { AutomationsModule } from '../automations/automations.module';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ProjectAccessModule } from '../project-access/project-access.module';
import { SectionsModule } from '../sections/sections.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { BundlesController } from './bundles.controller';
import { BundlesService } from './bundles.service';

@Module({
  imports: [
    AutomationsModule,
    CustomFieldsModule,
    ProjectAccessModule,
    SectionsModule,
    WorkspaceMembersModule,
  ],
  controllers: [BundlesController],
  providers: [BundlesService],
})
export class BundlesModule {}
