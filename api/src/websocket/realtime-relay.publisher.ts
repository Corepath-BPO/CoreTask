import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

/** The Redis channel the worker's broadcasts travel over. */
export const REALTIME_RELAY_CHANNEL = 'coretask:realtime-relay';

/** One broadcast, as it crosses the process boundary. */
export interface RealtimeRelayMessage {
  /** Which project room to address. */
  projectId?: string;
  /**
   * Or which workspace room — for a signal that carries nothing private, such
   * as "the tickets list changed", to screens that are not in a project room.
   */
  workspaceId?: string;
  /**
   * Or everyone who may see this project, wherever they are in the app: the
   * workspace room when it is public, its members' and admins' own rooms when
   * it is private. Needs `workspaceId`. Resolved on the API side, where the
   * rule of who may see what lives.
   */
  audienceOf?: string;
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
    await this.publish({ projectId, event, payload });
  }

  /**
   * To everyone who may see the project, not only the tabs open on it.
   *
   * A task panel opened from My Tasks, the inbox or search sits in no project
   * room, so a change sent only to the room never reaches it. This reaches the
   * people a person's own edit does — and, since they include everyone the
   * room would admit, every tab on the project too.
   */
  async toProjectAudience(
    workspaceId: string,
    projectId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.publish({ workspaceId, audienceOf: projectId, event, payload });
  }

  /**
   * To everyone in a workspace's room. Only for payloads that say *that*
   * something changed, never what: a private project's details belong in its
   * own room, which checks membership on join.
   */
  async toWorkspace(
    workspaceId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.publish({ workspaceId, event, payload });
  }

  private async publish(message: RealtimeRelayMessage): Promise<void> {
    try {
      await this.redis.client.publish(REALTIME_RELAY_CHANNEL, JSON.stringify(message));
    } catch (error) {
      this.logger.warn(
        { err: error, event: message.event },
        'Could not publish a realtime relay message',
      );
    }
  }
}
