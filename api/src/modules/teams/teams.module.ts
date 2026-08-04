import { Module } from '@nestjs/common';

import { ActivityLogsModule } from '../activity-logs/activity-logs.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [WorkspaceMembersModule, ActivityLogsModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
