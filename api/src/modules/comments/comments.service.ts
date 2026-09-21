import {
  ActivityAction,
  ActivityEntity,
  AttachmentStatus,
  AutomationTrigger,
  CommentEntity,
  MAX_MENTIONS_PER_COMMENT,
  NOTIFICATION_BODY_LENGTH,
  NotificationType,
  ServerEvent,
  WorkspaceRole,
  hasAtLeastRole,
  parseAnyMentionIds,
} from '@coretask/contracts';
import type { Comment, CommentListMeta } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Comment as PrismaComment } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult, type ActorContext } from '../../common/types/api.types';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { htmlToText, normalizeCommentBody } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { ProjectBroadcastService } from '../../websocket/project-broadcast.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import { FollowersService } from '../followers/followers.service';
import { linkOf, type ItemLink } from '../followers/item-ref';
import { ProjectAccessService } from '../project-access/project-access.service';
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
  link: ItemLink;
  label: string;
  /** In-app path the notification links to. */
  actionUrl: string;
  /** The project the item sits in; null means no automation event is raised, like every other write. */
  projectId: string | null;
}

/** A comment row plus the project its item sits in, for the checks that need it. */
type CommentRow = PrismaComment & { projectId: string | null };

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly tickets: TicketsService,
    private readonly activity: ActivityLogsService,
    private readonly access: ProjectAccessService,
    private readonly broadcast: ProjectBroadcastService,
    private readonly notifications: NotificationDispatcher,
    private readonly followers: FollowersService,
    private readonly automation: AutomationEventPublisher,
  ) {}

  async listForTask(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    query: CommentListQueryDto,
  ): Promise<PaginatedResult<Comment, CommentListMeta>> {
    const parent = await this.resolveTask(workspaceId, taskId, actor);
    return this.list(workspaceId, parent, actor.userId, query);
  }

  async listForTicket(
    workspaceId: string,
    actor: ActorContext,
    idOrKey: string,
    query: CommentListQueryDto,
  ): Promise<PaginatedResult<Comment, CommentListMeta>> {
    const parent = await this.resolveTicket(workspaceId, idOrKey, actor);
    return this.list(workspaceId, parent, actor.userId, query);
  }

  async createForTask(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    const parent = await this.resolveTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    return this.create(workspaceId, actor.userId, parent, dto);
  }

  async createForTicket(
    workspaceId: string,
    actor: ActorContext,
    idOrKey: string,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    const parent = await this.resolveTicket(workspaceId, idOrKey, actor, WorkspaceRole.MEMBER);
    return this.create(workspaceId, actor.userId, parent, dto);
  }

  /** Only the author edits their own words — not even an owner rewrites them. */
  async update(
    workspaceId: string,
    actor: ActorContext,
    commentId: string,
    dto: UpdateCommentDto,
  ): Promise<Comment> {
    const { userId } = actor;
    const existing = await this.requireComment(workspaceId, commentId, actor);

    if (existing.authorId !== userId) {
      throw AppException.forbidden('FORBIDDEN', 'Only the author can edit a comment.');
    }

    const before = await this.prisma.commentMention.findMany({
      where: { commentId },
      select: { userId: true },
    });
    const alreadyMentioned = new Set(before.map((row) => row.userId));
    const body = this.requireBody(dto.body);
    const mentioned = await this.resolveMentions(workspaceId, body);

    const updated = await this.prisma.comment.update({
      where: { id: commentId },
      data: {
        body,
        // `editedAt` is what the UI reads to mark a comment "edited", so it is
        // set here rather than derived from `updatedAt`, which any write moves.
        editedAt: new Date(),
        // The body is the source of truth, so the index is rebuilt from it:
        // removing a token removes the mention.
        mentions: {
          deleteMany: {},
          create: mentioned.map((id) => ({ userId: id })),
        },
      },
      include: commentInclude,
    });

    const comment = toCommentDto(updated, userId);
    void this.broadcast.emit(
      workspaceId,
      existing.projectId,
      ServerEvent.COMMENT_UPDATED,
      toCommentDto(updated, null),
    );

    // Only people the edit *added*. Fixing a typo must not re-ping everyone who
    // was already named.
    const newlyMentioned = mentioned.filter((id) => !alreadyMentioned.has(id));
    if (newlyMentioned.length > 0) {
      // Being named makes you a collaborator, on an edit as on a fresh post.
      await this.followers.ensure(workspaceId, linkOf(existing), newlyMentioned);

      const parent = await this.resolveParentOf(workspaceId, existing, actor);
      if (parent) {
        await this.notifyMentioned(workspaceId, userId, parent, updated, newlyMentioned);
      }
    }

    return comment;
  }

  /**
   * Soft delete. The row stays because activity entries point at it, and a
   * dangling reference in an audit trail is worse than a row nobody renders.
   * Authors delete their own; MANAGER and above can remove anyone's.
   */
  async remove(
    workspaceId: string,
    actor: ActorContext,
    commentId: string,
  ): Promise<{ deleted: true }> {
    const { userId } = actor;
    const existing = await this.requireComment(workspaceId, commentId, actor);

    // "Manager" as judged inside the item's project, so a viewer there cannot
    // delete what they may only read.
    const isAuthor = existing.authorId === userId;
    const effective = await this.access.effectiveRoleFor(existing.projectId, actor);
    if (!isAuthor && !hasAtLeastRole(effective, WorkspaceRole.MANAGER)) {
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
        projectId: existing.projectId,
        summary: 'Removed a comment posted by someone else',
        metadata: { authorId: existing.authorId },
      });
    }

    void this.broadcast.emit(workspaceId, existing.projectId, ServerEvent.COMMENT_DELETED, {
      id: commentId,
      taskId: existing.taskId,
      ticketId: existing.ticketId,
    });

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * The latest window of a thread, oldest first within it, or the window
   * before `before`. The pinned comment rides in the first page whatever its
   * age, because the top of the thread is where it is shown.
   */
  private async list(
    workspaceId: string,
    parent: CommentParent,
    viewerId: string | null,
    query: CommentListQueryDto,
  ): Promise<PaginatedResult<Comment, CommentListMeta>> {
    const where: Prisma.CommentWhereInput = {
      workspaceId,
      ...parent.link,
      deletedAt: null,
    };
    const limit = query.limit;

    const [total, newestFirst, pinned] = await Promise.all([
      this.prisma.comment.count({ where }),
      this.prisma.comment.findMany({
        where: { ...where, ...(query.before ? { id: { lt: query.before } } : {}) },
        include: commentInclude,
        orderBy: { id: 'desc' },
        take: limit + 1,
      }),
      query.before
        ? Promise.resolve(null)
        : this.prisma.comment.findFirst({
            where: { ...where, pinnedAt: { not: null } },
            include: commentInclude,
          }),
    ]);

    const hasEarlier = newestFirst.length > limit;
    // Back to reading order: a conversation reads top to bottom.
    const page = newestFirst.slice(0, limit).reverse();

    if (pinned && !page.some((comment) => comment.id === pinned.id)) {
      page.unshift(pinned);
    }

    const earliest = newestFirst.slice(0, limit).at(-1);
    const meta: CommentListMeta = {
      ...buildPaginationMeta({ page: 1, limit }, total),
      hasEarlier,
      earliestId: hasEarlier ? (earliest?.id ?? null) : null,
      pinnedCommentId: pinned?.id ?? null,
    };

    return new PaginatedResult(
      page.map((comment: CommentWithAuthor) => toCommentDto(comment, viewerId)),
      meta,
    );
  }

  /** A thumbs-up. Liking twice is one like; the row's key says so. */
  async like(workspaceId: string, actor: ActorContext, commentId: string): Promise<Comment> {
    const { userId } = actor;
    const existing = await this.requireComment(workspaceId, commentId, actor);
    await this.access.assertEffectiveRole(existing.projectId, actor, WorkspaceRole.MEMBER);

    try {
      await this.prisma.commentLike.create({ data: { commentId, userId } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }

    return this.reread(workspaceId, existing, userId);
  }

  async unlike(workspaceId: string, actor: ActorContext, commentId: string): Promise<Comment> {
    const { userId } = actor;
    const existing = await this.requireComment(workspaceId, commentId, actor);
    await this.access.assertEffectiveRole(existing.projectId, actor, WorkspaceRole.MEMBER);
    await this.prisma.commentLike.deleteMany({ where: { commentId, userId } });
    return this.reread(workspaceId, existing, userId);
  }

  /**
   * Pins a comment to the top of its thread — one per thread, so pinning
   * replaces whatever was pinned before. Authors and managers only; a pin is
   * a statement about the thread, not a reaction to it.
   */
  async pin(workspaceId: string, actor: ActorContext, commentId: string): Promise<Comment> {
    const { userId } = actor;
    const existing = await this.requireComment(workspaceId, commentId, actor);
    await this.assertMayPin(existing, actor);

    await this.prisma.$transaction([
      this.prisma.comment.updateMany({
        where: { workspaceId, ...linkOf(existing), pinnedAt: { not: null } },
        data: { pinnedAt: null, pinnedById: null },
      }),
      this.prisma.comment.update({
        where: { id: commentId },
        data: { pinnedAt: new Date(), pinnedById: userId },
      }),
    ]);

    await this.recordPin(workspaceId, userId, existing, ActivityAction.PINNED);
    return this.reread(workspaceId, existing, userId);
  }

  async unpin(workspaceId: string, actor: ActorContext, commentId: string): Promise<Comment> {
    const { userId } = actor;
    const existing = await this.requireComment(workspaceId, commentId, actor);
    await this.assertMayPin(existing, actor);

    if (existing.pinnedAt !== null) {
      await this.prisma.comment.update({
        where: { id: commentId },
        data: { pinnedAt: null, pinnedById: null },
      });
      await this.recordPin(workspaceId, userId, existing, ActivityAction.UNPINNED);
    }

    return this.reread(workspaceId, existing, userId);
  }

  private async assertMayPin(comment: CommentRow, actor: ActorContext): Promise<void> {
    if (comment.authorId === actor.userId) return;

    const effective = await this.access.effectiveRoleFor(comment.projectId, actor);
    if (!hasAtLeastRole(effective, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only the author or a workspace manager can pin a comment.',
      );
    }
  }

  private async recordPin(
    workspaceId: string,
    userId: string,
    comment: CommentRow,
    action: typeof ActivityAction.PINNED | typeof ActivityAction.UNPINNED,
  ): Promise<void> {
    await this.activity.record({
      workspaceId,
      actorId: userId,
      action,
      entity: comment.taskId ? ActivityEntity.TASK : ActivityEntity.TICKET,
      entityId: (comment.taskId ?? comment.ticketId) as string,
      projectId: comment.projectId,
      summary: action === ActivityAction.PINNED ? 'Pinned a comment' : 'Unpinned a comment',
      metadata: { commentId: comment.id },
    });
  }

  /** The comment as it now stands, announced to the room and returned to the caller. */
  private async reread(
    workspaceId: string,
    comment: CommentRow,
    viewerId: string,
  ): Promise<Comment> {
    const row = await this.prisma.comment.findUniqueOrThrow({
      where: { id: comment.id },
      include: commentInclude,
    });

    // Emitted without a viewer: `likedByMe` is somebody else's to compute.
    void this.broadcast.emit(
      workspaceId,
      comment.projectId,
      ServerEvent.COMMENT_UPDATED,
      toCommentDto(row, null),
    );

    return toCommentDto(row, viewerId);
  }

  private async create(
    workspaceId: string,
    userId: string,
    parent: CommentParent,
    dto: CreateCommentDto,
  ): Promise<Comment> {
    const body = this.requireBody(dto.body);
    const mentioned = await this.resolveMentions(workspaceId, body);
    const attachmentIds = [...new Set(dto.attachmentIds ?? [])];

    /*
     * The files were uploaded to the item while the comment was being written
     * — it did not exist yet — and are claimed here. Only the author's own
     * confirmed files on this item, not already shown by another comment: the
     * count of rows the update touched is the check, and anything short of
     * the full list means one of them was somebody else's, elsewhere, or
     * still uploading. In one transaction, so a refused claim leaves no
     * comment behind.
     */
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.comment.create({
        data: {
          workspaceId,
          authorId: userId,
          body,
          ...parent.link,
          mentions: { create: mentioned.map((id) => ({ userId: id })) },
        },
      });

      if (attachmentIds.length > 0) {
        const claimed = await tx.attachment.updateMany({
          where: {
            id: { in: attachmentIds },
            workspaceId,
            ...parent.link,
            status: AttachmentStatus.READY,
            uploaderId: userId,
            commentId: null,
          },
          data: { commentId: row.id },
        });

        if (claimed.count !== attachmentIds.length) {
          throw AppException.badRequest(
            'BAD_REQUEST',
            'Some attachments are not on this item, are not yours, or are already in a comment.',
          );
        }
      }

      return tx.comment.findUniqueOrThrow({ where: { id: row.id }, include: commentInclude });
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.COMMENTED,
      entity: ActivityEntity.COMMENT,
      entityId: created.id,
      projectId: parent.projectId,
      summary: `Commented on ${parent.label}`,
      metadata: { entity: parent.entity },
    });

    // The same door every other write uses: rules can react to a comment, and
    // webhooks carry it out. The task rides in `after` so the runner can load
    // it; comments on items outside a project raise nothing, like other writes.
    if (parent.projectId) {
      await this.automation.publish({
        workspaceId,
        projectId: parent.projectId,
        trigger: AutomationTrigger.COMMENT_ADDED,
        entityType: 'COMMENT',
        entityId: created.id,
        actorId: userId,
        after: {
          taskId: parent.link.taskId,
          ticketId: parent.link.ticketId,
          authorId: userId,
          mentionCount: mentioned.length,
          excerpt: htmlToText(body).slice(0, NOTIFICATION_BODY_LENGTH),
        },
      });
    }

    const comment = toCommentDto(created, userId);
    void this.broadcast.emit(
      workspaceId,
      parent.projectId,
      ServerEvent.COMMENT_CREATED,
      toCommentDto(created, null),
    );

    // Joining a thread by replying is the signal that you care about it, and
    // being named is a stronger one: both make you a collaborator, before the
    // fan-out below decides who hears about this comment.
    await this.followers.ensure(workspaceId, parent.link, [userId, ...mentioned]);

    await this.notifyMentioned(workspaceId, userId, parent, created, mentioned);
    await this.notifyFollowers(workspaceId, userId, parent, created, mentioned);
    this.logger.log(
      { commentId: created.id, entity: parent.entity, mentions: mentioned.length },
      'Comment created',
    );

    return comment;
  }

  /**
   * Reads mentions out of the body and keeps only current workspace members.
   *
   * Parsing server-side is the point: a client cannot claim to have mentioned
   * someone it did not, and so cannot use mentions to notify people at will.
   *
   * A token naming someone who has since left is dropped rather than rejected.
   * Erroring would mean an old comment could no longer be edited at all, which
   * is a worse outcome than a mention that quietly stops resolving.
   */
  /**
   * The body as it will be stored: sanitised HTML, whatever shape arrived.
   * Markup with nothing in it is refused the way whitespace is — the DTO
   * cannot tell `<p></p>` from a sentence, so the check lives here.
   */
  private requireBody(raw: string): string {
    const body = normalizeCommentBody(raw);
    if (!body) {
      throw AppException.unprocessable('VALIDATION_FAILED', 'Write something first.');
    }
    return body;
  }

  /** Words only, for an inbox line; a comment that is just a picture says so. */
  private notificationBody(body: string): string {
    return htmlToText(body).slice(0, NOTIFICATION_BODY_LENGTH) || '(image)';
  }

  private async resolveMentions(workspaceId: string, body: string): Promise<string[]> {
    const ids = parseAnyMentionIds(body).slice(0, MAX_MENTIONS_PER_COMMENT);
    if (ids.length === 0) return [];

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: ids } },
      select: { userId: true },
    });

    const memberIds = new Set(members.map((row) => row.userId));
    return ids.filter((id) => memberIds.has(id));
  }

  /** Rebuilds the parent context for a comment that already exists. */
  private async resolveParentOf(
    workspaceId: string,
    comment: PrismaComment,
    actor: ActorContext,
  ): Promise<CommentParent | null> {
    if (comment.taskId) return this.resolveTask(workspaceId, comment.taskId, actor);
    if (comment.ticketId) return this.resolveTicket(workspaceId, comment.ticketId, actor);
    return null;
  }

  /**
   * Being named is a stronger signal than being subscribed, so it gets its own
   * notification type — and the generic thread notification is suppressed for
   * these people, because one comment should never arrive twice.
   */
  private async notifyMentioned(
    workspaceId: string,
    actorId: string,
    parent: CommentParent,
    comment: PrismaComment,
    mentioned: string[],
  ): Promise<void> {
    // Naming someone who cannot see the project must not hand them a link to it.
    const recipients = await this.access.filterVisibleTo(
      workspaceId,
      parent.projectId,
      mentioned.filter((id) => id !== actorId),
    );
    if (recipients.length === 0) return;

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { name: true },
    });

    await Promise.all(
      recipients.map((recipient) =>
        this.notifications.dispatch({
          userId: recipient,
          workspaceId,
          type: NotificationType.MENTIONED,
          title: `${actor?.name ?? 'Someone'} mentioned you on ${parent.label}`,
          // Markup in, words out: a notification body is plain text.
          body: this.notificationBody(comment.body),
          entity: ActivityEntity.COMMENT,
          entityId: comment.id,
          actionUrl: parent.actionUrl,
        }),
      ),
    );
  }

  /**
   * Notifies the item's collaborators — Asana's rule. The creator, the
   * assignee, everyone who has commented and everyone who was mentioned are
   * already following (see `FollowersService.ensure`), and anyone who left
   * the task is not, which is the whole point of letting people leave.
   */
  private async notifyFollowers(
    workspaceId: string,
    actorId: string,
    parent: CommentParent,
    comment: PrismaComment,
    mentioned: string[],
  ): Promise<void> {
    const followerIds = await this.followers.followerIds(workspaceId, parent.link);

    // Anyone named has already had the stronger `MENTIONED` notification.
    const alreadyTold = new Set([actorId, ...mentioned]);
    const recipients = new Set(followerIds.filter((id) => !alreadyTold.has(id)));

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
          body: this.notificationBody(comment.body),
          entity: ActivityEntity.COMMENT,
          entityId: comment.id,
          actionUrl: parent.actionUrl,
        }),
      ),
    );
  }

  private async resolveTask(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
    minimumRole?: WorkspaceRole,
  ): Promise<CommentParent> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, minimumRole);

    return {
      entity: CommentEntity.TASK,
      link: { taskId: task.id, ticketId: null },
      label: `“${task.title}”`,
      actionUrl: `/my-tasks?task=${task.id}`,
      projectId: task.projectId,
    };
  }

  private async resolveTicket(
    workspaceId: string,
    idOrKey: string,
    actor: ActorContext,
    minimumRole?: WorkspaceRole,
  ): Promise<CommentParent> {
    const ticket = await this.tickets.requireTicket(workspaceId, idOrKey, actor, minimumRole);

    return {
      entity: CommentEntity.TICKET,
      link: { taskId: null, ticketId: ticket.id },
      label: ticket.key,
      actionUrl: `/tickets?ticket=${ticket.key}`,
      projectId: ticket.projectId,
    };
  }

  /**
   * Soft-deleted comments are gone as far as every endpoint is concerned, and
   * so are comments on items in a private project the caller is not in.
   */
  private async requireComment(
    workspaceId: string,
    commentId: string,
    actor: ActorContext,
  ): Promise<CommentRow> {
    const comment = await this.prisma.comment.findFirst({
      where: {
        id: commentId,
        workspaceId,
        deletedAt: null,
        AND: [this.access.itemParentWhere(actor)],
      },
      include: { task: { select: { projectId: true } }, ticket: { select: { projectId: true } } },
    });

    if (!comment) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Comment not found.');
    }

    const { task, ticket, ...row } = comment;
    return { ...row, projectId: task?.projectId ?? ticket?.projectId ?? null };
  }
}
