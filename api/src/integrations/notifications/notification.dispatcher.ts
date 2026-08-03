import { ServerEvent } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';

import {
  type CreateNotificationInput,
  NotificationsService,
} from '../../modules/notifications/notifications.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';

/**
 * Fan-out layer for notifications.
 *
 * `NotificationsService` owns storage; this owns *delivery*. Today that means
 * one channel (in-app over Socket.IO). E-mail and push subscribe here later
 * without any caller changing.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** Never throws: a notification failure must not roll back the action behind it. */
  async dispatch(input: CreateNotificationInput): Promise<void> {
    try {
      const notification = await this.notifications.create(input);

      this.realtime.emitToUser(input.userId, ServerEvent.NOTIFICATION_CREATED, {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        workspaceId: notification.workspaceId,
        actionUrl: notification.actionUrl,
        createdAt: notification.createdAt.toISOString(),
      });
    } catch (error) {
      this.logger.error({ err: error, userId: input.userId }, 'Failed to dispatch notification');
    }
  }
}
