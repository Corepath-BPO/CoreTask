import {
  ActivityAction,
  ActivityEntity,
  AutomationTrigger,
  CLOSED_TICKET_STATUSES,
  NotificationType,
  ServerEvent,
  TICKET_KEY_PATTERN,
  TicketPriority,
  TicketStatus,
  WorkspaceRole,
} from '@coretask/contracts';
import type { Ticket, TicketDetail, TicketListMeta, TicketListSummary } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Ticket as PrismaTicket } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult, type ActorContext } from '../../common/types/api.types';
import { buildPaginationMeta, toSkipTake } from '../../common/utils/pagination.util';
import { normalizeRichText } from '../../common/utils/rich-text.util';
import { toCalendarDate } from '../../common/utils/schedule.util';
import { UUID_PATTERN } from '../../common/utils/uuid.util';
import { PrismaService } from '../../database/prisma.service';
import { DescriptionMentionNotifier } from '../../integrations/notifications/description-mention.notifier';
import { FollowerNotifier } from '../../integrations/notifications/follower.notifier';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { ProjectBroadcastService } from '../../websocket/project-broadcast.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { diffItemStories, snapshotFromTicket } from '../activity-logs/item-stories';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import { FollowersService } from '../followers/followers.service';
import { ticketLink, ticketRef } from '../followers/item-ref';
import { ProjectAccessService } from '../project-access/project-access.service';

import type { CreateTicketDto, TicketListQueryDto, UpdateTicketDto } from './dto/ticket.dto';
import {
  ticketDetailInclude,
  ticketInclude,
  toTicketDetailDto,
  toTicketDto,
} from './ticket.mapper';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogsService,
    private readonly access: ProjectAccessService,
    private readonly broadcast: ProjectBroadcastService,
    private readonly automation: AutomationEventPublisher,
    private readonly notifications: NotificationDispatcher,
    private readonly mentions: DescriptionMentionNotifier,
    private readonly followers: FollowersService,
    private readonly followerNotifier: FollowerNotifier,
  ) {}

  async list(
    workspaceId: string,
    actor: ActorContext,
    query: TicketListQueryDto,
  ): Promise<PaginatedResult<Ticket, TicketListMeta>> {
    const where = this.buildWhere(workspaceId, actor, query);

    const [total, tickets] = await Promise.all([
      this.prisma.ticket.count({ where }),
      this.prisma.ticket.findMany({
        where,
        include: ticketInclude,
        // Newest first: a queue is read from the top, and `number` is a
        // monotonic per-workspace stand-in for creation order.
        orderBy: { number: 'desc' },
        ...toSkipTake(query),
      }),
    ]);

    const summary = await this.summarize(workspaceId, query, actor);

    return new PaginatedResult(tickets.map(toTicketDto), {
      ...buildPaginationMeta(query, total),
      summary,
    });
  }

  /**
   * Loads by UUID or by human key (`CORE-1001`).
   *
   * Keys are what people paste into chat and commit messages, so a link built
   * from one has to resolve without the reader first looking up an id.
   */
  async getDetail(
    workspaceId: string,
    idOrKey: string,
    actor: ActorContext,
  ): Promise<TicketDetail> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { workspaceId, ...this.identify(idOrKey), AND: [this.access.scopedWhere(actor)] },
      include: ticketDetailInclude,
    });

    if (!ticket) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Ticket not found.');
    }

    return toTicketDetailDto(ticket);
  }

  async create(workspaceId: string, actor: ActorContext, dto: CreateTicketDto): Promise<Ticket> {
    const { userId } = actor;
    await this.assertAssigneeIsMember(workspaceId, dto.assigneeId);
    // The project arrives in the body, out of `ProjectAccessGuard`'s sight:
    // invisible is a 404, visible but read-only is a 403.
    if (dto.projectId) {
      await this.access.requireAccess(workspaceId, dto.projectId, actor, WorkspaceRole.MEMBER);
    }
    await this.assertAssigneeCanSee(workspaceId, dto.projectId ?? null, dto.assigneeId);

    const status = dto.status ?? TicketStatus.OPEN;

    const created = await this.prisma.$transaction(async (tx) => {
      /*
       * Allocating the key inside the transaction is what makes numbering
       * gapless and collision-free. `update ... increment` takes a row lock on
       * the workspace, so two concurrent creates serialise here rather than
       * both reading the same counter and racing to insert the same key.
       */
      const workspace = await tx.workspace.update({
        where: { id: workspaceId },
        data: { ticketCounter: { increment: 1 } },
        select: { ticketPrefix: true, ticketCounter: true },
      });

      const number = workspace.ticketCounter;

      return tx.ticket.create({
        data: {
          workspaceId,
          projectId: dto.projectId ?? null,
          number,
          key: `${workspace.ticketPrefix}-${number}`,
          title: dto.title,
          description: normalizeRichText(dto.description) ?? null,
          ...(dto.type ? { type: dto.type } : {}),
          status,
          ...(dto.priority ? { priority: dto.priority } : {}),
          ...(dto.severity ? { severity: dto.severity } : {}),
          reporterId: userId,
          assigneeId: dto.assigneeId ?? null,
          dueDate: toDate(dto.dueDate),
          ...this.lifecycleTimestamps(status, null, null),
        },
        include: ticketInclude,
      });
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.TICKET,
      entityId: created.id,
      projectId: created.projectId,
      summary: `Reported ${created.key}: ${created.title}`,
      metadata: { key: created.key, type: created.type, priority: created.priority },
    });

    const ticket = toTicketDto(created);
    void this.broadcast.emit(workspaceId, created.projectId, ServerEvent.TICKET_CREATED, ticket);

    await this.followers.ensure(workspaceId, ticketLink(created.id), [
      created.reporterId,
      created.assigneeId,
    ]);

    if (created.projectId) {
      await this.automation.publish({
        workspaceId,
        projectId: created.projectId,
        trigger: AutomationTrigger.TICKET_CREATED,
        entityType: 'TICKET',
        entityId: created.id,
        actorId: userId,
        after: { title: created.title, status: created.status },
      });
    }

    await this.notifyAssignment(workspaceId, userId, created, null);
    await this.mentions.notify({
      workspaceId,
      actorId: userId,
      entity: 'TICKET',
      entityId: created.id,
      projectId: created.projectId,
      label: created.key,
      actionUrl: `/tickets?ticket=${created.key}`,
      before: null,
      after: created.description,
    });
    this.logger.log({ ticketId: created.id, key: created.key }, 'Ticket created');

    return ticket;
  }

  async update(
    workspaceId: string,
    actor: ActorContext,
    idOrKey: string,
    dto: UpdateTicketDto,
  ): Promise<Ticket> {
    const { userId } = actor;
    const existing = await this.requireTicket(workspaceId, idOrKey, actor, WorkspaceRole.MEMBER);

    await this.assertAssigneeIsMember(workspaceId, dto.assigneeId);
    // Moving a ticket into a project is a write into that project.
    if (dto.projectId) {
      await this.access.requireAccess(workspaceId, dto.projectId, actor, WorkspaceRole.MEMBER);
    }
    const targetProjectId = dto.projectId === undefined ? existing.projectId : dto.projectId;
    await this.assertAssigneeCanSee(
      workspaceId,
      targetProjectId,
      dto.assigneeId === undefined ? existing.assigneeId : dto.assigneeId,
    );

    const data: Prisma.TicketUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = normalizeRichText(dto.description);
    if (dto.type !== undefined) data.type = dto.type;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.severity !== undefined) data.severity = dto.severity;
    if (dto.dueDate !== undefined) data.dueDate = toDate(dto.dueDate);
    if (dto.assigneeId !== undefined) {
      data.assignee = dto.assigneeId ? { connect: { id: dto.assigneeId } } : { disconnect: true };
    }
    if (dto.projectId !== undefined) {
      data.project = dto.projectId ? { connect: { id: dto.projectId } } : { disconnect: true };
    }

    const statusChanged = dto.status !== undefined && dto.status !== existing.status;
    if (dto.status !== undefined) {
      data.status = dto.status;
      Object.assign(
        data,
        this.lifecycleTimestamps(dto.status, existing.resolvedAt, existing.closedAt),
      );
    }

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    const updated = await this.prisma.ticket.update({
      where: { id: existing.id },
      data,
      include: ticketInclude,
    });

    const previousAssignee =
      existing.assigneeId && existing.assigneeId !== updated.assigneeId
        ? await this.prisma.user.findUnique({
            where: { id: existing.assigneeId },
            select: { id: true, name: true },
          })
        : updated.assignee;
    const stories = diffItemStories(
      snapshotFromTicket(existing, {
        assignee:
          existing.assigneeId && previousAssignee
            ? { id: previousAssignee.id, label: previousAssignee.name }
            : null,
      }),
      snapshotFromTicket(updated, {
        assignee: updated.assignee
          ? { id: updated.assignee.id, label: updated.assignee.name }
          : null,
      }),
      'ticket',
    );
    const context = {
      workspaceId,
      actorId: userId,
      entity: ActivityEntity.TICKET,
      entityId: existing.id,
      projectId: updated.projectId,
    };
    if (stories.length > 0) {
      await this.activity.recordStories(context, stories);
    } else {
      await this.activity.record({
        ...context,
        action: ActivityAction.UPDATED,
        summary: `Updated ${updated.key}`,
        metadata: { fields: Object.keys(data) },
      });
    }

    const ticket = toTicketDto(updated);
    void this.broadcast.emit(workspaceId, updated.projectId, ServerEvent.TICKET_UPDATED, ticket);

    if (updated.assigneeId && updated.assigneeId !== existing.assigneeId) {
      await this.followers.ensure(workspaceId, ticketLink(updated.id), [updated.assigneeId]);
    }
    await this.followerNotifier.notifyStories(ticketRef(workspaceId, updated), userId, stories);

    if (dto.description !== undefined) {
      await this.mentions.notify({
        workspaceId,
        actorId: userId,
        entity: 'TICKET',
        entityId: updated.id,
        projectId: updated.projectId,
        label: updated.key,
        actionUrl: `/tickets?ticket=${updated.key}`,
        before: existing.description,
        after: updated.description,
      });
    }

    if (statusChanged && updated.projectId) {
      await this.automation.publish({
        workspaceId,
        projectId: updated.projectId,
        trigger: AutomationTrigger.TICKET_STATUS_CHANGED,
        entityType: 'TICKET',
        entityId: updated.id,
        actorId: userId,
        before: { status: existing.status },
        after: { status: updated.status },
      });
    }

    await this.notifyAssignment(workspaceId, userId, updated, existing.assigneeId);

    return ticket;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Keeps `resolvedAt` / `closedAt` derived from status rather than settable.
   *
   * Closing implies resolution, so a ticket closed without passing through
   * RESOLVED still gets a resolution timestamp — otherwise "time to resolve"
   * reporting would silently miss those.
   */
  private lifecycleTimestamps(
    status: TicketStatus,
    resolvedAt: Date | null,
    closedAt: Date | null,
  ): { resolvedAt: Date | null; closedAt: Date | null } {
    const now = new Date();

    if (status === TicketStatus.CLOSED) {
      return { resolvedAt: resolvedAt ?? now, closedAt: closedAt ?? now };
    }

    if (status === TicketStatus.RESOLVED) {
      return { resolvedAt: resolvedAt ?? now, closedAt: null };
    }

    // Reopened: the ticket is live again, so neither timestamp applies.
    return { resolvedAt: null, closedAt: null };
  }

  private buildWhere(
    workspaceId: string,
    actor: ActorContext,
    query: TicketListQueryDto,
  ): Prisma.TicketWhereInput {
    // `me` saves a round trip to learn your own id, and makes a shared queue
    // link resolve per viewer.
    const assigneeId = query.assigneeId === 'me' ? actor.userId : query.assigneeId;
    const reporterId = query.reporterId === 'me' ? actor.userId : query.reporterId;

    // An explicit status filter speaks for itself; otherwise the queue hides
    // finished work unless the caller asks for it.
    const status = query.status?.length
      ? { in: query.status }
      : query.includeClosed
        ? undefined
        : { notIn: [...CLOSED_TICKET_STATUSES] };

    return {
      workspaceId,
      // Tickets in projects the caller cannot see are not in their queue.
      AND: [this.access.scopedWhere(actor)],
      ...(status ? { status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(reporterId ? { reporterId } : {}),
      ...(query.type?.length ? { type: { in: query.type } } : {}),
      ...(query.priority?.length ? { priority: { in: query.priority } } : {}),
      ...(query.severity?.length ? { severity: { in: query.severity } } : {}),
      ...(query.dueBefore || query.dueAfter
        ? {
            dueDate: {
              ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
              ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
            },
          }
        : {}),
      ...(query.search ? this.searchFilter(query.search) : {}),
    };
  }

  /** A search that looks like a key matches it exactly; anything else is a title search. */
  private searchFilter(search: string): Prisma.TicketWhereInput {
    const candidate = search.trim().toUpperCase();

    if (TICKET_KEY_PATTERN.test(candidate)) {
      return { key: candidate };
    }

    return { title: { contains: search, mode: 'insensitive' } };
  }

  /**
   * Rollup over the workspace, ignoring the caller's status filter.
   *
   * The tiles answer "how is the queue doing?", which must not change shape
   * just because someone filtered the list below them to one status.
   */
  private async summarize(
    workspaceId: string,
    query: TicketListQueryDto,
    actor: ActorContext,
  ): Promise<TicketListSummary> {
    const scope: Prisma.TicketWhereInput = {
      workspaceId,
      // Its own scope, so it gets its own privacy filter — the tiles must not
      // count work the list beneath them hides.
      AND: [this.access.scopedWhere(actor)],
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.assigneeId
        ? { assigneeId: query.assigneeId === 'me' ? actor.userId : query.assigneeId }
        : {}),
    };

    const open = { status: { notIn: [...CLOSED_TICKET_STATUSES] } };

    const [total, openCount, urgent, unassigned, resolved, overdue] = await Promise.all([
      this.prisma.ticket.count({ where: scope }),
      this.prisma.ticket.count({ where: { ...scope, ...open } }),
      this.prisma.ticket.count({
        where: { ...scope, ...open, priority: TicketPriority.URGENT },
      }),
      this.prisma.ticket.count({ where: { ...scope, ...open, assigneeId: null } }),
      this.prisma.ticket.count({ where: { ...scope, status: TicketStatus.RESOLVED } }),
      this.prisma.ticket.count({
        where: { ...scope, ...open, dueDate: { lt: new Date() } },
      }),
    ]);

    return { total, open: openCount, urgent, unassigned, resolved, overdue };
  }

  /** Resolves a path segment that may be a UUID or a key like `CORE-1001`. */
  private identify(idOrKey: string): Prisma.TicketWhereInput {
    return UUID_PATTERN.test(idOrKey) ? { id: idOrKey } : { key: idOrKey.toUpperCase() };
  }

  /**
   * Public for the same reason as `TasksService.requireTask`, and it carries the
   * id-or-key resolution with it, so `/tickets/CORE-1001/comments` works without
   * that rule being duplicated.
   */
  async requireTicket(
    workspaceId: string,
    idOrKey: string,
    actor: ActorContext,
    minimumRole?: WorkspaceRole,
  ): Promise<PrismaTicket> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { workspaceId, ...this.identify(idOrKey), AND: [this.access.scopedWhere(actor)] },
    });

    if (!ticket) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Ticket not found.');
    }

    if (minimumRole) {
      await this.access.assertEffectiveRole(ticket.projectId, actor, minimumRole);
    }

    return ticket;
  }

  private async assertAssigneeIsMember(
    workspaceId: string,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeId) return;

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
      select: { id: true },
    });

    if (!membership) {
      throw AppException.badRequest('BAD_REQUEST', 'The assignee must be a workspace member.');
    }
  }

  /** Assigning work someone cannot open helps nobody: they would get a notification to a 404. */
  private async assertAssigneeCanSee(
    workspaceId: string,
    projectId: string | null,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeId) return;

    await this.access.assertUsersCanSee(
      workspaceId,
      projectId,
      [assigneeId],
      'The assignee must be able to see this project.',
    );
  }

  private async notifyAssignment(
    workspaceId: string,
    actorId: string,
    ticket: PrismaTicket,
    previousAssigneeId: string | null,
  ): Promise<void> {
    if (!ticket.assigneeId || ticket.assigneeId === previousAssigneeId) return;
    if (ticket.assigneeId === actorId) return;

    await this.notifications.dispatch({
      userId: ticket.assigneeId,
      workspaceId,
      type: NotificationType.TICKET_ASSIGNED,
      title: `${ticket.key} was assigned to you`,
      body: ticket.title,
      entity: ActivityEntity.TICKET,
      entityId: ticket.id,
      // Query param rather than a path segment: there is no ticket detail
      // route, the queue page opens the dialog from this instead.
      actionUrl: `/tickets?ticket=${ticket.key}`,
    });
  }
}

/** A ticket's deadline is a calendar date; whatever clock arrives is dropped. */
function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : toCalendarDate(value);
}
