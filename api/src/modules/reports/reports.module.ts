import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
