import { Module } from '@nestjs/common';

import { SlackApiClient } from './slack-api.client';

/** Slack's Web API, for the request side and for the worker's deliveries alike. */
@Module({
  providers: [SlackApiClient],
  exports: [SlackApiClient],
})
export class SlackClientModule {}
