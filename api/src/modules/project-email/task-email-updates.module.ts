import { Module } from '@nestjs/common';

import { TaskEmailUpdatesService } from './task-email-updates.service';

/** The outbound half of email to a project; see {@link TaskEmailUpdatesService}. */
@Module({
  providers: [TaskEmailUpdatesService],
  exports: [TaskEmailUpdatesService],
})
export class TaskEmailUpdatesModule {}
