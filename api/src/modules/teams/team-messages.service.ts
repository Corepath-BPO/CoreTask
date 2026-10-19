import {
  ActivityEntity,
  NotificationType,
  PROJECT_FEED_PAGE_SIZE,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { PostProjectMessagePayload, TeamMessage, UpdateAuthor } from '@coretask/types';
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
} satisfies Prisma.TeamMessageInclude;

type MessageRow = Prisma.TeamMessageGetPayload<{ include: typeof messageInclude }>;

const toAuthor = (user: UpdateAuthor | null): UpdateAuthor | null =>
  user ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl } : null;

function toMessage(row: MessageRow): TeamMessage {
  return {
    id: row.id,
    teamId: row.teamId,
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
 * A team's Messages tab — Asana's team conversations.
 *
 * Teams are visible to the whole workspace, and so are their messages. The
 * team's members post and reply, as does any manager; deleting is the
 * author's or a manager's. A new message tells the team; a reply tells the
 * people already in that conversation.
 */
@Injectable()
export class TeamMessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async list(workspaceId: string, teamId: string): Promise<TeamMessage[]> {
    await this.requireTeam(workspaceId, teamId);
    const rows = await this.prisma.teamMessage.findMany({
      where: { teamId },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: PROJECT_FEED_PAGE_SIZE,
    });
    return rows.map(toMessage);
  }

  async post(
    workspaceId: string,
    teamId: string,
    actor: ActorContext,
    payload: PostProjectMessagePayload,
  ): Promise<TeamMessage> {
    const team = await this.requireTeam(workspaceId, teamId);
    await this.assertMayPost(team.id, actor);

    const body = normalizeRichText(payload.body);
    if (!body) throw AppException.badRequest('BAD_REQUEST', 'Write something in the message.');

    const row = await this.prisma.teamMessage.create({
      data: { workspaceId, teamId, authorId: actor.userId, title: payload.title.trim(), body },
      include: messageInclude,
    });

    const members = await this.prisma.teamMember.findMany({
      where: { teamId },
      select: { userId: true },
    });
    const audience = new Set(
      members.map((member) => member.userId).filter((id) => id !== actor.userId),
    );
    await this.tell(workspaceId, teamId, audience, {
      title: `${row.author?.name ?? 'Somebody'} posted in ${team.name}: ${row.title}`,
      body: htmlToText(body).slice(0, 200),
    });

    return toMessage(row);
  }

  async reply(
    workspaceId: string,
    teamId: string,
    messageId: string,
    actor: ActorContext,
    text: string,
  ): Promise<TeamMessage> {
    const team = await this.requireTeam(workspaceId, teamId);
    await this.assertMayPost(team.id, actor);

    const message = await this.prisma.teamMessage.findFirst({
      where: { id: messageId, teamId, workspaceId },
      select: { id: true, title: true, authorId: true, replies: { select: { authorId: true } } },
    });
    if (!message) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Message not found.');

    const body = normalizeRichText(text);
    if (!body) throw AppException.badRequest('BAD_REQUEST', 'Write something in the reply.');

    await this.prisma.teamMessageReply.create({
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
    await this.tell(workspaceId, teamId, audience, {
      title: `${author?.name ?? 'Somebody'} replied to “${message.title}” in ${team.name}`,
      body: htmlToText(body).slice(0, 200),
    });

    const row = await this.prisma.teamMessage.findUniqueOrThrow({
      where: { id: message.id },
      include: messageInclude,
    });
    return toMessage(row);
  }

  async remove(
    workspaceId: string,
    teamId: string,
    messageId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requireTeam(workspaceId, teamId);
    const row = await this.prisma.teamMessage.findFirst({
      where: { id: messageId, teamId, workspaceId },
      select: { id: true, authorId: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Message not found.');

    if (row.authorId !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden('FORBIDDEN', 'Only its author or a manager can delete it.');
    }
    await this.prisma.teamMessage.delete({ where: { id: row.id } });
  }

  // -------------------------------------------------------------------------

  private async requireTeam(workspaceId: string, teamId: string) {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, workspaceId },
      select: { id: true, name: true },
    });
    if (!team) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Team not found.');
    return team;
  }

  /** The team's own members post, and any manager; guests and outsiders read. */
  private async assertMayPost(teamId: string, actor: ActorContext): Promise<void> {
    if (hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) return;
    const onTeam = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId, userId: actor.userId } },
      select: { userId: true },
    });
    if (!onTeam || !hasAtLeastRole(actor.role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'Only the team’s members post in its messages.');
    }
  }

  private async tell(
    workspaceId: string,
    teamId: string,
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
        actionUrl: `/teams/${teamId}?tab=messages`,
      });
    }
  }
}
