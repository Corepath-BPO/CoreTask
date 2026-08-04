import { Module } from '@nestjs/common';

import { AutomationRunnerService } from './automation-runner.service';

/**
 * The engine, with nothing attached.
 *
 * Depends on Prisma alone — deliberately, so the worker can register it without
 * pulling in the request-side graph the way importing a full domain module
 * would. It writes through Prisma rather than through TasksService for the same
 * reason.
 */
@Module({
  providers: [AutomationRunnerService],
  exports: [AutomationRunnerService],
})
export class AutomationRunnerModule {}
