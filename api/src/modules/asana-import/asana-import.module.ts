import { Module } from '@nestjs/common';

import { AsanaClientModule } from '../../integrations/asana/asana.module';
import { ImportQueue } from '../../jobs/import/import.queue';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';

import { AsanaImportController } from './asana-import.controller';
import { AsanaImportService } from './asana-import.service';

/** The request side of the Asana import: who may start one, and how it is going. */
@Module({
  imports: [AsanaClientModule, WorkspacesModule, WorkspaceMembersModule],
  controllers: [AsanaImportController],
  providers: [AsanaImportService, ImportQueue],
})
export class AsanaImportModule {}
