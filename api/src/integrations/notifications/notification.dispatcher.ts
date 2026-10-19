import { ServerEvent } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { escapeHtml } from '../../common/utils/rich-text.util';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { EmailQueue } from '../../jobs/email/email.queue';
import { NotificationPreferencesService } from '../../modules/notifications/notification-preferences.service';
import {
  type CreateNotificationInput,
  NotificationsService,
} from '../../modules/notifications/notifications.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';

/**
 * Fan-out layer for notifications.
 *
 * `NotificationsService` owns storage; this owns *delivery*: in-app over
 * Socket.IO, and by email for the kinds a person chose in Settings ›
 * Notifications (assignments and mentions until they choose). No caller
 * knows about either channel.
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly preferences: NotificationPreferencesService,
    private readonly prisma: PrismaService,
    private readonly email: EmailQueue,
    private readonly config: AppConfigService,
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

      await this.emailIfWanted(input);
    } catch (error) {
      this.logger.error({ err: error, userId: input.userId }, 'Failed to dispatch notification');
    }
  }

  /** The same notification by email, when its kind is one the person asked for. */
  private async emailIfWanted(input: CreateNotificationInput): Promise<void> {
    if (!input.workspaceId) return;
    if (!(await this.preferences.wantsEmail(input.workspaceId, input.userId, input.type))) return;
    const user = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true, name: true, isServiceAccount: true },
    });
    if (!user || user.isServiceAccount) return;

    const webUrl = this.config.http.webUrl.replace(/\/$/, '');
    const link = input.actionUrl
      ? input.actionUrl.startsWith('http')
        ? input.actionUrl
        : `${webUrl}${input.actionUrl.startsWith('/') ? '' : '/'}${input.actionUrl}`
      : webUrl;
    const settings = `${webUrl}/settings`;
    const body = input.body?.trim() ?? '';

    await this.email.enqueueMessage({
      to: user.email,
      // "You were assigned a task" says little in an inbox; its body names the task.
      subject: subjectOf(input.title, body),
      text: [
        input.title,
        ...(body ? ['', body] : []),
        '',
        `Open in CoreTask: ${link}`,
        '',
        `Choose which emails you get: ${settings}`,
      ].join('\n'),
      html: [
        `<p><strong>${escapeHtml(input.title)}</strong></p>`,
        ...(body ? [`<p>${escapeHtml(body)}</p>`] : []),
        `<p><a href="${escapeHtml(link)}">Open in CoreTask</a></p>`,
        `<p style="color:#6b7280;font-size:12px">You get this because of your notification settings. <a href="${escapeHtml(settings)}">Choose which emails you get</a>.</p>`,
      ].join(''),
    });
  }
}

/** The title, with a short body after it when there is one: "You were assigned a task: Fix the gate". */
function subjectOf(title: string, body: string): string {
  const line = body.replace(/\s+/g, ' ').trim();
  const subject = line && line.length <= 120 ? `${title}: ${line}` : title;
  return subject.length > 150 ? `${subject.slice(0, 149)}…` : subject;
}
