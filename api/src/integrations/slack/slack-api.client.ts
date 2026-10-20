import { Injectable, Logger } from '@nestjs/common';

import { fetchWithTimeout } from '../../common/utils/http.util';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Slack said no. `error` is Slack's own code (`channel_not_found`,
 * `invalid_auth`…); `retryable` is whether trying again later could help.
 */
export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    readonly error: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(`Slack ${method} failed: ${error}`);
    this.name = 'SlackApiError';
  }
}

/** Codes that are Slack's own trouble rather than the request's. */
const RETRYABLE = new Set([
  'ratelimited',
  'internal_error',
  'fatal_error',
  'service_unavailable',
  'request_timeout',
]);

export interface SlackOAuthAccess {
  team: { id: string; name: string };
  botUserId: string;
  accessToken: string;
  scopes: string[];
  /** The person who approved the install. */
  authedUserId: string | null;
}

export interface SlackMessage {
  text: string;
  blocks?: unknown[];
}

export interface SlackConversation {
  id: string;
  name: string;
  is_private?: boolean;
  is_archived?: boolean;
}

/** How many pages of channels the picker will read: 1,000 channels. */
const MAX_CHANNEL_PAGES = 5;

/**
 * The few Slack Web API methods CoreTask uses, against `fetch`.
 *
 * Every Slack method answers 200 with `{ ok }`, so the HTTP status says
 * little: a 429 is the one worth reading, for its Retry-After. The base URL
 * is configurable only so the tests can stand in for Slack.
 */
@Injectable()
export class SlackApiClient {
  private readonly logger = new Logger(SlackApiClient.name);

  constructor(private readonly config: AppConfigService) {}

  /** Finishes an install: the code Slack sent back, for the bot token. */
  async oauthAccess(code: string): Promise<SlackOAuthAccess> {
    const { clientId, clientSecret, redirectUri } = this.config.slack;
    const result = await this.call<{
      team?: { id?: string; name?: string };
      bot_user_id?: string;
      access_token?: string;
      scope?: string;
      token_type?: string;
      authed_user?: { id?: string };
    }>('oauth.v2.access', {
      form: { code, redirect_uri: redirectUri },
      basic: `${clientId ?? ''}:${clientSecret ?? ''}`,
    });

    if (
      result.token_type !== 'bot' ||
      !result.access_token ||
      !result.team?.id ||
      !result.bot_user_id
    ) {
      throw new SlackApiError('oauth.v2.access', 'no_bot_token', false);
    }

    return {
      team: { id: result.team.id, name: result.team.name ?? 'Slack' },
      botUserId: result.bot_user_id,
      accessToken: result.access_token,
      scopes: (result.scope ?? '').split(',').filter(Boolean),
      authedUserId: result.authed_user?.id ?? null,
    };
  }

  /** Ends the bot token; Slack takes the app out of the workspace with it. */
  async revoke(token: string): Promise<void> {
    await this.call('auth.revoke', { token, json: {} });
  }

  postMessage(
    token: string,
    channel: string,
    message: SlackMessage,
  ): Promise<{ ts: string; channel: string }> {
    return this.call('chat.postMessage', {
      token,
      json: { channel, ...message, unfurl_links: false, unfurl_media: false },
    });
  }

  async updateMessage(
    token: string,
    channel: string,
    ts: string,
    message: SlackMessage,
  ): Promise<void> {
    await this.call('chat.update', { token, json: { channel, ts, ...message } });
  }

  /** Seen only by `user`, in `channel`. */
  async postEphemeral(
    token: string,
    channel: string,
    user: string,
    message: SlackMessage,
  ): Promise<void> {
    await this.call('chat.postEphemeral', { token, json: { channel, user, ...message } });
  }

  /** A modal, which Slack only opens within three seconds of the click that asked for it. */
  async openView(token: string, triggerId: string, view: unknown): Promise<void> {
    await this.call('views.open', { token, json: { trigger_id: triggerId, view } });
  }

  async channelInfo(token: string, channel: string): Promise<SlackConversation> {
    const result = await this.call<{ channel?: SlackConversation }>('conversations.info', {
      token,
      form: { channel },
    });
    if (!result.channel) throw new SlackApiError('conversations.info', 'channel_not_found', false);
    return result.channel;
  }

  /**
   * Channels the bot can post to: every public one, and the private ones it
   * has been invited to — Slack lists no others to a bot.
   */
  async listChannels(token: string): Promise<SlackConversation[]> {
    const channels: SlackConversation[] = [];
    let cursor = '';
    for (let page = 0; page < MAX_CHANNEL_PAGES; page += 1) {
      const result = await this.call<{
        channels?: SlackConversation[];
        response_metadata?: { next_cursor?: string };
      }>('conversations.list', {
        token,
        form: {
          types: 'public_channel,private_channel',
          exclude_archived: 'true',
          limit: '200',
          ...(cursor ? { cursor } : {}),
        },
      });
      channels.push(...(result.channels ?? []));
      cursor = result.response_metadata?.next_cursor ?? '';
      if (!cursor) break;
    }
    return channels;
  }

  // -------------------------------------------------------------------------

  private async call<T>(
    method: string,
    input: {
      token?: string;
      basic?: string;
      json?: Record<string, unknown>;
      form?: Record<string, string>;
    },
  ): Promise<T> {
    const { apiBaseUrl, timeoutMs } = this.config.slack;
    const headers: Record<string, string> = {};
    if (input.token) headers['Authorization'] = `Bearer ${input.token}`;
    if (input.basic) {
      headers['Authorization'] = `Basic ${Buffer.from(input.basic).toString('base64')}`;
    }

    let body: string;
    if (input.json) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
      body = JSON.stringify(input.json);
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(input.form ?? {}).toString();
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        `${apiBaseUrl}/${method}`,
        { method: 'POST', headers, body, redirect: 'error' },
        timeoutMs,
        'Slack',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ method, err: message }, 'Slack could not be reached');
      throw new SlackApiError(method, 'unreachable', true);
    }

    if (response.status === 429) {
      const after = Number(response.headers.get('retry-after'));
      throw new SlackApiError(method, 'ratelimited', true, Number.isFinite(after) ? after : null);
    }
    if (response.status >= 500) {
      throw new SlackApiError(method, `http_${response.status}`, true);
    }

    let result: { ok?: boolean; error?: string } & Record<string, unknown>;
    try {
      result = (await response.json()) as typeof result;
    } catch {
      throw new SlackApiError(method, `http_${response.status}`, response.status >= 500);
    }

    if (!result.ok) {
      const error = typeof result.error === 'string' ? result.error : 'unknown_error';
      throw new SlackApiError(method, error, RETRYABLE.has(error));
    }
    return result as T;
  }
}
