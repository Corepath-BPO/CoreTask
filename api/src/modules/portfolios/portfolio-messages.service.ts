import {
  ActivityEntity,
  NotificationType,
  PROJECT_FEED_PAGE_SIZE,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { PortfolioMessage, PostProjectMessagePayload, UpdateAuthor } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { htmlToText, normalizeRichText } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';

const authorSelect = { select: { id: true, name: true, avatarUrl: true } } as const;

const messageInclude = {
  author: authorSelect,
  replies: { orderBy: { createdAt: 'asc' }, include: { author: authorSelect } },
} satisfies Prisma.PortfolioMessageInclude;

type MessageRow = Prisma.PortfolioMessageGetPayload<{ include: typeof messageInclude }>;

const toAuthor = (user: UpdateAuthor | null): UpdateAuthor | null =>
  user ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl } : null;

function toMessage(row: MessageRow): PortfolioMessage {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    title: row.title,
    body: row.body,
    author: toAuthor(row.author),
    replies: row.replies.map((reply) => ({
      id: reply.id,
      body: reply.body,
      author: toAuthor(reply.author),
      createdAt: reply.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A portfolio's Messages tab — the conversation about a set of projects
 * rather than any one of them.
 *
 * A portfolio is shared with the whole workspace, so its messages are too.
 * Posting and replying are for members (a guest reads), deleting is the
 * author's or a manager's — the project Messages tab's rules, at portfolio
 * scale. A new message tells the portfolio's owner and whoever starred it;
 * a reply tells the people already in that conversation.
 */
@Injectable()
export class PortfolioMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async list(
    workspaceId: string,
    portfolioId: string,
    _actor: ActorContext,
  ): Promise<PortfolioMessage[]> {
    await this.requirePortfolio(workspaceId, portfolioId);
    const rows = await this.prisma.portfolioMessage.findMany({
      where: { portfolioId },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: PROJECT_FEED_PAGE_SIZE,
    });
    return rows.map(toMessage);
  }

  async post(
    workspaceId: string,
    portfolioId: string,
    actor: ActorContext,
    payload: PostProjectMessagePayload,
  ): Promise<PortfolioMessage> {
    this.assertMember(actor);
    const portfolio = await this.requirePortfolio(workspaceId, portfolioId);

    const body = normalizeRichText(payload.body);
    if (!body) throw AppException.badRequest('BAD_REQUEST', 'Write something in the message.');

    const row = await this.prisma.portfolioMessage.create({
      data: { workspaceId, portfolioId, authorId: actor.userId, title: payload.title.trim(), body },
      include: messageInclude,
    });

    // The owner and everyone following the portfolio by its star.
    const stars = await this.prisma.portfolioStar.findMany({
      where: { portfolioId },
      select: { userId: true },
    });
    const audience = new Set(
      [portfolio.ownerId, ...stars.map((star) => star.userId)].filter(
        (id): id is string => id !== null && id !== actor.userId,
      ),
    );
    await this.tell(workspaceId, portfolioId, audience, {
      title: `${row.author?.name ?? 'Somebody'} posted in ${portfolio.name}: ${row.title}`,
      body: htmlToText(body).slice(0, 200),
    });

    return toMessage(row);
  }

  async reply(
    workspaceId: string,
    portfolioId: string,
    messageId: string,
    actor: ActorContext,
    text: string,
  ): Promise<PortfolioMessage> {
    this.assertMember(actor);
    const portfolio = await this.requirePortfolio(workspaceId, portfolioId);

    const message = await this.prisma.portfolioMessage.findFirst({
      where: { id: messageId, portfolioId, workspaceId },
      select: { id: true, title: true, authorId: true, replies: { select: { authorId: true } } },
    });
    if (!message) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Message not found.');

    const body = normalizeRichText(text);
    if (!body) throw AppException.badRequest('BAD_REQUEST', 'Write something in the reply.');

    await this.prisma.portfolioMessageReply.create({
      data: { messageId: message.id, authorId: actor.userId, body },
    });

    const author = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true },
    });
    const audience = new Set(
      [message.authorId, ...message.replies.map((reply) => reply.authorId)].filter(
        (id): id is string => id !== null && id !== actor.userId,
      ),
    );
    await this.tell(workspaceId, portfolioId, audience, {
      title: `${author?.name ?? 'Somebody'} replied to “${message.title}” in ${portfolio.name}`,
      body: htmlToText(body).slice(0, 200),
    });

    const row = await this.prisma.portfolioMessage.findUniqueOrThrow({
      where: { id: message.id },
      include: messageInclude,
    });
    return toMessage(row);
  }

  async remove(
    workspaceId: string,
    portfolioId: string,
    messageId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requirePortfolio(workspaceId, portfolioId);
    const row = await this.prisma.portfolioMessage.findFirst({
      where: { id: messageId, portfolioId, workspaceId },
      select: { id: true, authorId: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Message not found.');

    if (row.authorId !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden('FORBIDDEN', 'Only its author or a manager can delete it.');
    }
    await this.prisma.portfolioMessage.delete({ where: { id: row.id } });
  }

  // -------------------------------------------------------------------------

  private async requirePortfolio(workspaceId: string, portfolioId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: portfolioId, workspaceId },
      select: { id: true, name: true, ownerId: true },
    });
    if (!portfolio) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Portfolio not found.');
    return portfolio;
  }

  private assertMember(actor: ActorContext): void {
    if (!hasAtLeastRole(actor.role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'Guests can read portfolio messages, not post.');
    }
  }

  private async tell(
    workspaceId: string,
    portfolioId: string,
    audience: ReadonlySet<string>,
    notice: { title: string; body: string },
  ): Promise<void> {
    for (const userId of audience) {
      await this.notifications.dispatch({
        userId,
        workspaceId,
        type: NotificationType.PROJECT_UPDATE,
        title: notice.title.slice(0, 200),
        body: notice.body,
        entity: ActivityEntity.WORKSPACE,
        entityId: workspaceId,
        actionUrl: `/portfolios/${portfolioId}/messages`,
      });
    }
  }
}
