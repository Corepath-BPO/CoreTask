import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ActivityLogsController } from './activity-logs.controller';
import { ActivityLogsService } from './activity-logs.service';

@Module({
  imports: [WorkspaceMembersModule, ProjectAccessModule],
  controllers: [ActivityLogsController],
  providers: [ActivityLogsService],
  exports: [ActivityLogsService],
})
export class ActivityLogsModule {}
