import {
  ActivityEntity,
  NotificationType,
  StoryField,
  isStoryRef,
  type FieldStoryMetadata,
} from '@coretask/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import type { StoryDraft } from '../../modules/activity-logs/item-stories';
import { FollowersService } from '../../modules/followers/followers.service';
import type { ItemRef } from '../../modules/followers/item-ref';

import { NotificationDispatcher } from './notification.dispatcher';

/**
 * Tells an item's collaborators about the changes worth an inbox line.
 *
 * Asana's rule, and deliberately narrow: completion (or a ticket's status)
 * and the due date. A renamed task or an edited description is in the feed
 * for anyone who opens the panel; pinging every follower for it would train
 * people to ignore the inbox. One notification per follower per write, even
 * when several properties moved at once.
 */
@Injectable()
export class FollowerNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly followers: FollowersService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async notifyStories(
    ref: ItemRef,
    actorId: string | null,
    stories: readonly StoryDraft[],
  ): Promise<void> {
    const worth = stories.filter((story) => this.worthAnInboxLine(story.metadata));
    if (worth.length === 0) return;

    const recipients = (await this.followers.followerIds(ref.workspaceId, ref.link)).filter(
      (id) => id !== actorId,
    );
    if (recipients.length === 0) return;

    const actor = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } })
      : null;
    const actorName = actorId ? (actor?.name ?? 'Someone') : 'An automation';

    const primary = worth[0] as StoryDraft;
    const isTask = ref.entity === ActivityEntity.TASK;
    const statusLike =
      primary.metadata.field === StoryField.COMPLETED ||
      primary.metadata.field === StoryField.STATUS;

    const type = statusLike
      ? isTask
        ? NotificationType.TASK_STATUS_CHANGED
        : NotificationType.TICKET_STATUS_CHANGED
      : isTask
        ? NotificationType.TASK_UPDATED
        : NotificationType.TICKET_UPDATED;

    const title = `${actorName} ${this.phrase(primary.metadata, ref.label)}`;
    const extra = worth.length - 1;
    const body = extra > 0 ? `and ${extra} more change${extra === 1 ? '' : 's'}` : null;

    await Promise.all(
      recipients.map((userId) =>
        this.notifications.dispatch({
          userId,
          workspaceId: ref.workspaceId,
          type,
          title,
          body,
          entity: ref.entity,
          entityId: ref.entityId,
          actionUrl: ref.actionUrl,
        }),
      ),
    );
  }

  private worthAnInboxLine(metadata: FieldStoryMetadata): boolean {
    return (
      metadata.field === StoryField.COMPLETED ||
      metadata.field === StoryField.STATUS ||
      metadata.field === StoryField.DUE_DATE
    );
  }

  private phrase(metadata: FieldStoryMetadata, label: string): string {
    switch (metadata.field) {
      case StoryField.COMPLETED:
        return metadata.after === 'complete'
          ? `marked ${label} complete`
          : `marked ${label} incomplete`;
      case StoryField.STATUS:
        return isStoryRef(metadata.after)
          ? `moved ${label} to ${metadata.after.label}`
          : `changed the status of ${label}`;
      case StoryField.DUE_DATE:
        return metadata.after === null
          ? `removed the due date on ${label}`
          : metadata.before === null
            ? `set a due date on ${label}`
            : `changed the due date on ${label}`;
      default:
        return `updated ${label}`;
    }
  }
}
