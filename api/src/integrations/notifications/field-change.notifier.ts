import { ActivityEntity, NotificationType } from '@coretask/contracts';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { FollowersService } from '../../modules/followers/followers.service';
import { taskLink } from '../../modules/followers/item-ref';

import { NotificationDispatcher } from './notification.dispatcher';

export interface FieldChange {
  workspaceId: string;
  taskId: string;
  taskTitle: string;
  /** Null for a rule's write. */
  actorId: string | null;
  fieldName: string;
  before: string | null;
  after: string | null;
}

/**
 * Asana's "notify task collaborators when this field changes".
 *
 * Only for fields a project flagged: most custom fields change a hundred
 * times a day and nobody wants an inbox line per edit, but a "Launch date"
 * or a "Severity" is exactly the kind of thing collaborators asked to hear
 * about. The recipients are the task's followers minus whoever made the
 * change; the person who set it does not need telling.
 */
@Injectable()
export class FieldChangeNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly followers: FollowersService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async notify(change: FieldChange): Promise<void> {
    const recipients = (
      await this.followers.followerIds(change.workspaceId, taskLink(change.taskId))
    ).filter((id) => id !== change.actorId);
    if (recipients.length === 0) return;

    const actor = change.actorId
      ? await this.prisma.user.findUnique({ where: { id: change.actorId }, select: { name: true } })
      : null;
    const who = change.actorId ? (actor?.name ?? 'Someone') : 'An automation';
    const label = `“${change.taskTitle}”`;

    const title =
      change.after === null
        ? `${who} cleared ${change.fieldName} on ${label}`
        : `${who} changed ${change.fieldName} to ${change.after} on ${label}`;
    const body =
      change.before !== null && change.after !== null
        ? `${change.before} → ${change.after}`
        : change.before !== null
          ? `was ${change.before}`
          : null;

    await Promise.all(
      recipients.map((userId) =>
        this.notifications.dispatch({
          userId,
          workspaceId: change.workspaceId,
          type: NotificationType.FIELD_CHANGED,
          title,
          body,
          entity: ActivityEntity.TASK,
          entityId: change.taskId,
          actionUrl: `/my-tasks?task=${change.taskId}`,
        }),
      ),
    );
  }
}
