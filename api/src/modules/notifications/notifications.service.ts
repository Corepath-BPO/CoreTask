import type { ActivityEntity, NotificationType } from '@coretask/contracts';
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

  listForUser(userId: string, options: { workspaceId?: string; limit?: number } = {}) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 30,
    });
  }

  countUnread(userId: string, workspaceId?: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        readAt: null,
        ...(workspaceId ? { workspaceId } : {}),
      },
    });
  }

  /** Scoped by `userId` so one user can never mark another's notification read. */
  async markRead(userId: string, notificationIds: string[]): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, id: { in: notificationIds }, readAt: null },
      data: { readAt: new Date() },
    });
    return count;
  }
}
