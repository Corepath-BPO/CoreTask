import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

/** The Redis channel the worker's broadcasts travel over. */
export const REALTIME_RELAY_CHANNEL = 'coretask:realtime-relay';

/** One broadcast, as it crosses the process boundary. */
export interface RealtimeRelayMessage {
  /** Which project room to address. */
  projectId: string;
  /** The socket event name, exactly as the gateway would emit it. */
  event: string;
  payload: Record<string, unknown>;
}

/**
 * The worker's road back to the browser.
 *
 * The socket server lives in the API process, and the automation runner lives
 * in the worker — so a rule that moved a task or set a field had no way to
 * tell an open tab about it. The list refetched when the *user's* action
 * landed, a beat before the rule ran, and then showed the stale row until
 * somebody reloaded; the task dialog, fetching fresh, disagreed with the list
 * behind it.
 *
 * Published over Redis pub/sub rather than a queue: a broadcast is only worth
 * delivering now. A tab that was closed does not want the message later, and a
 * queue would deliver it anyway, to nobody.
 *
 * Never throws — a broadcast that fails must not fail the rule that ran.
 */
@Injectable()
export class RealtimeRelayPublisher {
  private readonly logger = new Logger(RealtimeRelayPublisher.name);

  constructor(private readonly redis: RedisService) {}

  async toProject(
    projectId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const message: RealtimeRelayMessage = { projectId, event, payload };

    try {
      await this.redis.client.publish(REALTIME_RELAY_CHANNEL, JSON.stringify(message));
    } catch (error) {
      this.logger.warn({ err: error, event }, 'Could not publish a realtime relay message');
    }
  }
}
