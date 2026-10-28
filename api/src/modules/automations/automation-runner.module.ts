import { Module } from '@nestjs/common';

import { AiModule } from '../../integrations/ai/ai.module';
import { RealtimeRelayPublisher } from '../../websocket/realtime-relay.publisher';
import { FormulaValuesService } from '../custom-fields/formula-values.service';

import { AutomationAiService } from './automation-ai.service';
import { AutomationRunnerService } from './automation-runner.service';

/**
 * The engine, with almost nothing attached.
 *
 * Depends on Prisma, the realtime relay, the language model behind the AI
 * steps and the formula evaluator, which needs only Prisma — deliberately no more, so the worker can register it without pulling
 * in the request-side graph the way importing a full domain module would. It
 * writes through Prisma rather than through TasksService for the same reason;
 * the relay is how those writes still reach an open browser tab.
 */
@Module({
  imports: [AiModule],
  providers: [
    AutomationRunnerService,
    AutomationAiService,
    RealtimeRelayPublisher,
    FormulaValuesService,
  ],
  exports: [AutomationRunnerService],
})
export class AutomationRunnerModule {}
