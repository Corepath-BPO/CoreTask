import { Module } from '@nestjs/common';

import { AutomationClockService } from './automation-clock.service';
import { AutomationEventsModule } from './automation-events.module';

/**
 * The clock behind the time-driven triggers. Imported by the worker alone: the
 * schedule is registered there, once, so API replicas never tick it.
 */
@Module({
  imports: [AutomationEventsModule],
  providers: [AutomationClockService],
  exports: [AutomationClockService],
})
export class AutomationClockModule {}
