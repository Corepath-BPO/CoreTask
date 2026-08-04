import { Module } from '@nestjs/common';

import { AutomationEventPublisher } from './automation-event.publisher';

/**
 * The publisher alone.
 *
 * Modules that change tasks import this to announce it. Keeping it separate
 * from the engine means the request path never depends on the runner, the
 * queue processor or anything either of them needs.
 */
@Module({
  providers: [AutomationEventPublisher],
  exports: [AutomationEventPublisher],
})
export class AutomationEventsModule {}
