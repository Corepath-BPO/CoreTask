import {
  ActivityAction,
  ActivityEntity,
  CommentEntity,
  NotificationType,
  ServerEvent,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { Comment } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Comment as PrismaComment, Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult } from '../../common/types/api.types';
import { buildPaginationMeta, toSkipTake } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { TasksService } from '../tasks/tasks.service';
import { TicketsService } from '../tickets/tickets.service';

import type { CommentListQueryDto, CreateCommentDto, UpdateCommentDto } from './dto/comment.dto';
import { commentInclude, toCommentDto, type CommentWithAuthor } from './comment.mapper';

/** What a comment hangs off, resolved to something the service can act on. */
interface CommentParent {
  entity: CommentEntity;
  /**
   * Doubles as the `where` filter and the `create` data. Both columns are always
   * named — a comment on a task has `ticketId: null` — so the filter is exact
   * rather than "task matches, ticket unconstrained".
   */
  link: { taskId: string | null; ticketId: string | null };
  /** Everyone with a standing interest, before the actor is removed. */
  watchers: (string | null)[];
  label: string;
  /** In-app path the notification links to. */
  actionUrl: string;
}

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly tickets: TicketsService,
    private readonly activity: ActivityLogsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async listForTask(
    workspaceId: string,
    taskId: string,
    query: CommentListQueryDto,
  ): Promise<PaginatedResult<Comment>> {
    const parent = await this.resolveTask(workspaceId, taskId);
    return this.list(workspaceId, parent, query);
  }

  async listForTicket(
    workspaceId: string,
    idOrKey: string,
    query: CommentListQueryDto,
  ): Promise<PaginatedResult<Comment>> {
    const parent = await this.resolveTicket(workspaceId, idOrKey);
    return this.list(workspaceId, parent, query);
  }

  async createForTask(
    workspaceId: string,
    userId: string,
    taskId: string,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    const parent = await this.resolveTask(workspaceId, taskId);
    return this.create(workspaceId, userId, parent, dto);
  }

  async createForTicket(
    workspaceId: string,
    userId: string,
    idOrKey: string,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    const parent = await this.resolveTicket(workspaceId, idOrKey);
    return this.create(workspaceId, userId, parent, dto);
  }

  /** Only the author edits their own words — not even an owner rewrites them. */
  async update(
    workspaceId: string,
    userId: string,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<Comment> {
    const existing = await this.requireComment(workspaceId, commentId);

    if (existing.authorId !== userId) {
      throw AppException.forbidden('FORBIDDEN', 'Only the author can edit a comment.');
    }

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      // `editedAt` is what the UI reads to mark a comment "edited", so it is set
      // here rather than derived from `updatedAt`, which any write would move.
      data: { body: dto.body, editedAt: new Date() },
      include: commentInclude,
    });

    const comment = toCommentDto(updated);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.COMMENT_UPDATED, comment);

    return comment;
  }

  /**
   * Soft delete. The row stays because activity entries point at it, and a
   * dangling reference in an audit trail is worse than a row nobody renders.
   * Authors delete their own; MANAGER and above can remove anyone's.
   */
  async remove(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    commentId: string,
  ): Promise<{ deleted: true }> {
    const existing = await this.requireComment(workspaceId, commentId);

    const isAuthor = existing.authorId === userId;
    if (!isAuthor && !hasAtLeastRole(role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only the author or a workspace manager can delete a comment.',
      );
    }

    await this.prisma.comment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });

    if (!isAuthor) {
      // Worth an audit line: someone removed words that were not theirs.
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.DELETED,
        entity: ActivityEntity.COMMENT,
        entityId: commentId,
        summary: 'Removed a comment posted by someone else',
        metadata: { authorId: existing.authorId },
      });
    }

    this.realtime.emitToWorkspace(workspaceId, ServerEvent.COMMENT_DELETED, {
      id: commentId,
      taskId: existing.taskId,
      ticketId: existing.ticketId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async list(
    workspaceId: string,
    parent: CommentParent,
    query: CommentListQueryDto,
  ): Promise<PaginatedResult<Comment>> {
    const where: Prisma.CommentWhereInput = {
      workspaceId,
      ...parent.link,
      deletedAt: null,
    };

    const [total, comments] = await Promise.all([
      this.prisma.comment.count({ where }),
      this.prisma.comment.findMany({
        where,
        include: commentInclude,
        // Oldest first: a conversation reads top to bottom.
        orderBy: { createdAt: 'asc' },
        ...toSkipTake(query),
      }),
    ]);

    return new PaginatedResult(
      comments.map((comment: CommentWithAuthor) => toCommentDto(comment)),
      buildPaginationMeta(query, total),
    );
  }

  private async create(
    workspaceId: string,
    userId: string,
    parent: CommentParent,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    const created = await this.prisma.comment.create({
      data: {
        workspaceId,
        authorId: userId,
        body: dto.body,
        ...parent.link,
      },
      include: commentInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.COMMENTED,
      entity: ActivityEntity.COMMENT,
      entityId: created.id,
      summary: `Commented on ${parent.label}`,
      metadata: { entity: parent.entity },
    });

    const comment = toCommentDto(created);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.COMMENT_CREATED, comment);
    await this.notifyWatchers(workspaceId, userId, parent, created);
    this.logger.log({ commentId: created.id, entity: parent.entity }, 'Comment created');

    return comment;
  }

  /**
   * Notifies everyone already involved: the people the work is assigned to or
   * was reported by, plus anyone who has commented on it before.
   *
   * Joining a thread by replying is the signal that you care about it — without
   * that, a two-person conversation goes silent for one of them the moment they
   * are not the assignee.
   */
  private async notifyWatchers(
    workspaceId: string,
    actorId: string,
    parent: CommentParent,
    comment: PrismaComment,
  ): Promise<void> {
    const priorAuthors = await this.prisma.comment.findMany({
      where: { workspaceId, ...parent.link, deletedAt: null, authorId: { not: actorId } },
      select: { authorId: true },
      distinct: ['authorId'],
    });

    const recipients = new Set(
      [...parent.watchers, ...priorAuthors.map((row) => row.authorId)].filter(
        (id): id is string => typeof id === 'string' && id !== actorId,
      ),
    );

    if (recipients.size === 0) return;

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    await Promise.all(
      [...recipients].map((recipient) =>
        this.notifications.dispatch({
          userId: recipient,
          workspaceId,
          type: NotificationType.COMMENT_CREATED,
          title: `${actor?.name ?? 'Someone'} commented on ${parent.label}`,
          body: comment.body,
          entity: ActivityEntity.COMMENT,
          entityId: comment.id,
          actionUrl: parent.actionUrl,
        }),
      ),
    );
  }

  private async resolveTask(workspaceId: string, taskId: string): Promise<CommentParent> {
    const task = await this.tasks.requireTask(workspaceId, taskId);

    return {
      entity: CommentEntity.TASK,
      link: { taskId: task.id, ticketId: null },
      watchers: [task.assigneeId, task.createdById],
      label: `“${task.title}”`,
      actionUrl: `/my-tasks?task=${task.id}`,
    };
  }

  private async resolveTicket(workspaceId: string, idOrKey: string): Promise<CommentParent> {
    const ticket = await this.tickets.requireTicket(workspaceId, idOrKey);

    return {
      entity: CommentEntity.TICKET,
      link: { taskId: null, ticketId: ticket.id },
      watchers: [ticket.assigneeId, ticket.reporterId],
      label: ticket.key,
      actionUrl: `/tickets?ticket=${ticket.key}`,
    };
  }

  /** Soft-deleted comments are gone as far as every endpoint is concerned. */
  private async requireComment(workspaceId: string, commentId: string): Promise<PrismaComment> {
    const comment = await this.prisma.comment.findFirst({
      where: { id: commentId, workspaceId, deletedAt: null },
    });

    if (!comment) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Comment not found.');
    }

    return comment;
  }
}
