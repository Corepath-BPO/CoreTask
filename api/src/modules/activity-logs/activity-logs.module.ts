import { Module } from '@nestjs/common';

import { ActivityLogsService } from './activity-logs.service';

@Module({
  providers: [ActivityLogsService],
  exports: [ActivityLogsService],
})
export class ActivityLogsModule {}
