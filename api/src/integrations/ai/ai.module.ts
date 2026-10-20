import { Module } from '@nestjs/common';

import { AiClient } from './ai-client';
import { AnthropicAiClient } from './anthropic-ai.client';

/** The language model, injected as `AiClient`. */
@Module({
  providers: [{ provide: AiClient, useClass: AnthropicAiClient }],
  exports: [AiClient],
})
export class AiModule {}
