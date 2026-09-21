import { Module } from '@nestjs/common';

import { RealtimeRelayPublisher } from '../../websocket/realtime-relay.publisher';

import { AutomationRunnerService } from './automation-runner.service';

/**
 * The engine, with almost nothing attached.
 *
 * Depends on Prisma and the realtime relay — deliberately no more, so the
 * worker can register it without pulling in the request-side graph the way
 * importing a full domain module would. It writes through Prisma rather than
 * through TasksService for the same reason; the relay is how those writes
 * still reach an open browser tab.
 */
@Module({
  providers: [AutomationRunnerService, RealtimeRelayPublisher],
  exports: [AutomationRunnerService],
})
export class AutomationRunnerModule {}
