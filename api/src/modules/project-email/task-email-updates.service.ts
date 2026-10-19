import { inboundAddress } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { escapeHtml, htmlToText } from '../../common/utils/rich-text.util';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { EmailQueue } from '../../jobs/email/email.queue';

/**
 * "Send recipients task updates automatically": a comment on a task that came
 * in by email goes out to the people outside the workspace who were on that
 * email, with the task's reply address — so answering the email answers on
 * the task. Members are not written to; their inbox already has it.
 *
 * Kept apart from the inbound side so comments can depend on it without
 * depending on everything that creates tasks from mail.
 */
@Injectable()
export class TaskEmailUpdatesService {
  private readonly logger = new Logger(TaskEmailUpdatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly email: EmailQueue,
  ) {}

  /** Never throws: the comment is saved whether or not the mail goes out. */
  async commentPosted(params: {
    taskId: string;
    authorName: string;
    body: string;
    /** Whoever wrote it by email, who needs no copy of their own words. */
    skipAddress?: string | null;
  }): Promise<void> {
    const { domain, enabled } = this.config.inboundEmail;
    if (!enabled || !domain) return;

    try {
      const recipients = await this.prisma.taskEmailRecipient.findMany({
        where: { taskId: params.taskId },
        orderBy: { createdAt: 'asc' },
      });
      const skip = params.skipAddress?.toLowerCase() ?? null;
      const to = recipients.filter((recipient) => recipient.address !== skip);
      if (to.length === 0) return;

      const projectId = to[0]?.projectId as string;
      const [inbox, task] = await Promise.all([
        this.prisma.projectEmailInbox.findUnique({ where: { projectId } }),
        this.prisma.task.findUnique({
          where: { id: params.taskId },
          select: { title: true },
        }),
      ]);
      if (!inbox || !inbox.isActive || !inbox.sendUpdates || !task) return;

      const replyTo = inboundAddress(inbox.token, domain, params.taskId);
      const words = htmlToText(params.body).trim() || '(an attachment)';
      const subject = `Re: ${task.title}`;
      const text = [
        `${params.authorName} commented on “${task.title}”:`,
        '',
        words,
        '',
        '— Reply to this email to answer on the task.',
      ].join('\n');
      const html = [
        `<p>${escapeHtml(params.authorName)} commented on “${escapeHtml(task.title)}”:</p>`,
        `<blockquote>${escapeHtml(words).replace(/\n/g, '<br>')}</blockquote>`,
        '<p style="color:#6b7280">Reply to this email to answer on the task.</p>',
      ].join('');

      for (const recipient of to) {
        await this.email.enqueueMessage({ to: recipient.address, subject, text, html, replyTo });
      }
    } catch (error) {
      this.logger.warn({ err: error, taskId: params.taskId }, 'Could not send task updates');
    }
  }
}
