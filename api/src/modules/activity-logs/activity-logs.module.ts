import { Module } from '@nestjs/common';

import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { ActivityLogsController } from './activity-logs.controller';
import { ActivityLogsService } from './activity-logs.service';

@Module({
  imports: [WorkspaceMembersModule],
  controllers: [ActivityLogsController],
  providers: [ActivityLogsService],
  exports: [ActivityLogsService],
})
export class ActivityLogsModule {}
