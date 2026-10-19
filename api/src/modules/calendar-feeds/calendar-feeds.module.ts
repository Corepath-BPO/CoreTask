import { Module } from '@nestjs/common';

import { ProjectAccessModule } from '../project-access/project-access.module';
import { WorkspaceMembersModule } from '../workspace-members/workspace-members.module';

import { CalendarFeedFileController, CalendarFeedsController } from './calendar-feeds.controller';
import { CalendarFeedsService } from './calendar-feeds.service';

@Module({
  imports: [ProjectAccessModule, WorkspaceMembersModule],
  controllers: [CalendarFeedsController, CalendarFeedFileController],
  providers: [CalendarFeedsService],
})
export class CalendarFeedsModule {}
