import { Injectable, Logger } from '@nestjs/common';

import { fetchWithTimeout, safeBody } from '../../common/utils/http.util';
import { AppConfigService } from '../../config/app-config.service';

import { AiClient, AiUnavailableError, type AiRequest, type AiToolCall } from './ai-client';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 1024;
/** One more go after this long when the service is busy, then give up. */
const RETRY_AFTER_MS = 2_000;

interface MessagesResponse {
  content?: { type: string; name?: unknown; input?: unknown }[];
}

/**
 * Anthropic's Messages API, with tool use.
 *
 * Against `fetch` rather than the SDK for the reason the Graph transport gives:
 * this needs one call, and the request and response it makes are a few lines
 * each. No conversation is kept — every step is a single question with the
 * task attached — so there is no history to manage either.
 */
@Injectable()
export class AnthropicAiClient extends AiClient {
  private readonly logger = new Logger(AnthropicAiClient.name);

  constructor(private readonly config: AppConfigService) {
    super();
  }

  get available(): boolean {
    return this.config.ai.enabled;
  }

  async call(request: AiRequest): Promise<AiToolCall[]> {
    const { apiKey, baseUrl, model, timeoutMs } = this.config.ai;
    if (!apiKey) throw new AiUnavailableError();

    const body = JSON.stringify({
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
      tool_choice: request.require ? { type: 'tool', name: request.require } : { type: 'any' },
    });

    const send = () =>
      fetchWithTimeout(
        `${baseUrl}/v1/messages`,
        {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': ANTHROPIC_VERSION,
            'content-type': 'application/json',
          },
          body,
        },
        timeoutMs,
        'The AI service',
      );

    let response = await send();

    // Rate-limited or overloaded is worth one more try; anything else is an
    // answer, and repeating the request would get the same one.
    if (response.status === 429 || response.status >= 500) {
      this.logger.warn(`The AI service answered ${response.status}; trying once more.`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS));
      response = await send();
    }

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('The AI service rejected the API key.');
      }
      throw new Error(
        `The AI service refused the request (${response.status}): ${await safeBody(response, 300)}`,
      );
    }

    const json = (await response.json()) as MessagesResponse;

    return (json.content ?? []).flatMap((block) =>
      block.type === 'tool_use' && typeof block.name === 'string'
        ? [{ name: block.name, input: isRecord(block.input) ? block.input : {} }]
        : [],
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
