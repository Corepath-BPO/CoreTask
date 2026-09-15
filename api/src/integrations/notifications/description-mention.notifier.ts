import {
  ActivityEntity,
  NOTIFICATION_BODY_LENGTH,
  NotificationType,
  parseDescriptionMentionIds,
} from '@coretask/contracts';
import { Injectable } from '@nestjs/common';

import { htmlToText } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { FollowersService } from '../../modules/followers/followers.service';
import { taskLink, ticketLink } from '../../modules/followers/item-ref';
import { ProjectAccessService } from '../../modules/project-access/project-access.service';

import { NotificationDispatcher } from './notification.dispatcher';

export interface DescriptionMentionChange {
  workspaceId: string;
  actorId: string;
  entity: 'TASK' | 'TICKET';
  entityId: string;
  /** The item's project; a mention cannot reach someone who cannot see it. */
  projectId: string | null;
  /** What the notification names — `“Ship the grid”`, `CORE-1042`. */
  label: string;
  actionUrl: string;
  /** The description as it was; null on create. */
  before: string | null;
  /** The description as it now stands, already sanitised. */
  after: string | null;
}

/**
 * Tells people they were named in a description.
 *
 * The same rule as a comment's mentions: being named is a stronger signal than
 * being subscribed, and only the people the *edit* added are told — fixing a
 * typo must not re-ping everyone already there. A comment keeps a join table
 * for that; a description is diffed instead, because the previous markup is
 * already in hand wherever it is rewritten. Re-adding a mention that was
 * removed notifies again, which is what the words mean.
 *
 * Only current workspace members who can see the item's project are told,
 * whatever the markup names: a chip can no more notify at will than a comment
 * token can, and naming an outsider in a private project's task must not
 * hand them a link to it.
 */
@Injectable()
export class DescriptionMentionNotifier {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationDispatcher,
    private readonly followers: FollowersService,
    private readonly access: ProjectAccessService,
  ) {}

  async notify(change: DescriptionMentionChange): Promise<void> {
    if (!change.after) return;

    const already = new Set(change.before ? parseDescriptionMentionIds(change.before) : []);
    const added = parseDescriptionMentionIds(change.after).filter(
      (userId) => !already.has(userId) && userId !== change.actorId,
    );
    if (added.length === 0) return;

    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: change.workspaceId, userId: { in: added } },
      select: { userId: true },
    });
    const memberIds = await this.access.filterVisibleTo(
      change.workspaceId,
      change.projectId,
      rows.map((row) => row.userId),
    );
    if (memberIds.length === 0) return;
    const members = memberIds.map((userId) => ({ userId }));

    // Named in the description means a collaborator from here on, as a
    // comment mention does. This is the one place all three description
    // paths — task, ticket, work item — meet.
    await this.followers.ensure(
      change.workspaceId,
      change.entity === 'TASK' ? taskLink(change.entityId) : ticketLink(change.entityId),
      memberIds,
    );

    const actor = await this.prisma.user.findUnique({
      where: { id: change.actorId },
      select: { name: true },
    });
    const body = htmlToText(change.after).slice(0, NOTIFICATION_BODY_LENGTH);

    await Promise.all(
      members.map((member) =>
        this.notifications.dispatch({
          userId: member.userId,
          workspaceId: change.workspaceId,
          type: NotificationType.MENTIONED,
          title: `${actor?.name ?? 'Someone'} mentioned you in ${change.label}`,
          body,
          entity: change.entity === 'TASK' ? ActivityEntity.TASK : ActivityEntity.TICKET,
          entityId: change.entityId,
          actionUrl: change.actionUrl,
        }),
      ),
    );
  }
}
