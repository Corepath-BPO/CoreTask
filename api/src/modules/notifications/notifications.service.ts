import {
  NOTIFICATION_FEED_LIMIT,
  type ActivityEntity,
  type NotificationType,
} from '@coretask/contracts';
import type { NotificationEntry, NotificationFeed } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Notification } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export interface CreateNotificationInput {
  userId: string;
  workspaceId?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  entity?: ActivityEntity | null;
  entityId?: string | null;
  actionUrl?: string | null;
}

/** Persistence for in-app notifications. Delivery is `NotificationDispatcher`. */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateNotificationInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        workspaceId: input.workspaceId ?? null,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body?.slice(0, 1_000) ?? null,
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
      },
    });
  }

  /**
   * One user's inbox for a workspace.
   *
   * `unreadCount` is counted rather than derived from `items`, so the badge stays
   * correct once the backlog is longer than the page.
   */
  async feed(
    userId: string,
    workspaceId: string,
    options: FeedOptions = {},
  ): Promise<NotificationFeed> {
    const limit = options.limit ?? NOTIFICATION_FEED_LIMIT;

    // Scoped by `userId` before anything else. An inbox is one person's, and
    // membership of the workspace must never be enough to read someone else's.
    const where = {
      userId,
      workspaceId,
      ...(options.unreadOnly ? { readAt: null } : {}),
      ...(options.types?.length ? { type: { in: options.types } } : {}),
    };

    const [rows, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        // Ordered by id, not createdAt: ids are UUID v7 so they sort the same
        // way, and unlike a timestamp they are unique — two notifications
        // written in the same millisecond would otherwise make the cursor
        // ambiguous and skip or repeat one.
        orderBy: { id: 'desc' },
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
        // One extra row answers "is there more?" without a second count.
        take: limit + 1,
      }),
      this.prisma.notification.count({ where: { userId, workspaceId, readAt: null } }),
    ]);

    const items = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? (items.at(-1)?.id ?? null) : null;

    return { items: items.map(toNotificationEntry), unreadCount, nextCursor };
  }

  /**
   * Scoped by `userId` so one user can never mark another's notification read.
   * Omitting `notificationIds` clears the whole workspace inbox.
   */
  async markRead(
    userId: string,
    workspaceId: string,
    notificationIds?: string[],
  ): Promise<{ updated: number; unreadCount: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: {
        userId,
        workspaceId,
        readAt: null,
        ...(notificationIds?.length ? { id: { in: notificationIds } } : {}),
      },
      data: { readAt: new Date() },
    });

    return { updated: count, unreadCount: await this.countUnread(userId, workspaceId) };
  }

  /**
   * Puts one notification back in the unread pile.
   *
   * Undo for a misclick, and a way to leave something for later. Deliberately
   * one at a time: "mark everything unread" has no honest use, and would let a
   * misplaced click resurrect an inbox somebody had finished with.
   */
  async markUnread(
    userId: string,
    workspaceId: string,
    notificationId: string,
  ): Promise<{ updated: number; unreadCount: number }> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, workspaceId, readAt: { not: null } },
      data: { readAt: null },
    });

    return { updated: count, unreadCount: await this.countUnread(userId, workspaceId) };
  }

  private countUnread(userId: string, workspaceId: string): Promise<number> {
    return this.prisma.notification.count({ where: { userId, workspaceId, readAt: null } });
  }
}

/** Filters and paging for one page of the inbox. */
export interface FeedOptions {
  limit?: number;
  unreadOnly?: boolean;
  types?: NotificationType[];
  cursor?: string;
}

function toNotificationEntry(notification: Notification): NotificationEntry {
  return {
    id: notification.id,
    userId: notification.userId,
    workspaceId: notification.workspaceId,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    entity: notification.entity,
    entityId: notification.entityId,
    actionUrl: notification.actionUrl,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
  };
}
