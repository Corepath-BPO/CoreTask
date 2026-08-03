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
    limit = NOTIFICATION_FEED_LIMIT,
  ): Promise<NotificationFeed> {
    const where = { userId, workspaceId };

    const [items, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
      }),
      this.prisma.notification.count({ where: { ...where, readAt: null } }),
    ]);

    return { items: items.map(toNotificationEntry), unreadCount };
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

    const unreadCount = await this.prisma.notification.count({
      where: { userId, workspaceId, readAt: null },
    });

    return { updated: count, unreadCount };
  }
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
