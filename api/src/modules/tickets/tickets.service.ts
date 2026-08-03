import {
  ActivityAction,
  ActivityEntity,
  CLOSED_TICKET_STATUSES,
  NotificationType,
  ServerEvent,
  TICKET_KEY_PATTERN,
  TicketPriority,
  TicketStatus,
} from '@coretask/contracts';
import type { Ticket, TicketDetail, TicketListMeta, TicketListSummary } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Ticket as PrismaTicket } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult } from '../../common/types/api.types';
import { buildPaginationMeta, toSkipTake } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

import type { CreateTicketDto, TicketListQueryDto, UpdateTicketDto } from './dto/ticket.dto';
import {
  ticketDetailInclude,
  ticketInclude,
  toTicketDetailDto,
  toTicketDto,
} from './ticket.mapper';

/** Matches a bare UUID, so a path segment can be told apart from a ticket key. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogsService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async list(
    workspaceId: string,
    userId: string,
    query: TicketListQueryDto,
  ): Promise<PaginatedResult<Ticket, TicketListMeta>> {
    const where = this.buildWhere(workspaceId, userId, query);

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

    const summary = await this.summarize(workspaceId, query, userId);

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
  async getDetail(workspaceId: string, idOrKey: string): Promise<TicketDetail> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { workspaceId, ...this.identify(idOrKey) },
      include: ticketDetailInclude,
    });

    if (!ticket) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Ticket not found.');
    }

    return toTicketDetailDto(ticket);
  }

  async create(workspaceId: string, userId: string, dto: CreateTicketDto): Promise<Ticket> {
    await this.assertAssigneeIsMember(workspaceId, dto.assigneeId);
    if (dto.projectId) await this.assertProjectInWorkspace(workspaceId, dto.projectId);

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
          description: dto.description ?? null,
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
      summary: `Reported ${created.key}: ${created.title}`,
      metadata: { key: created.key, type: created.type, priority: created.priority },
    });

    const ticket = toTicketDto(created);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TICKET_CREATED, ticket);
    await this.notifyAssignment(workspaceId, userId, created, null);
    this.logger.log({ ticketId: created.id, key: created.key }, 'Ticket created');

    return ticket;
  }

  async update(
    workspaceId: string,
    userId: string,
    idOrKey: string,
    dto: UpdateTicketDto,
  ): Promise<Ticket> {
    const existing = await this.requireTicket(workspaceId, idOrKey);

    await this.assertAssigneeIsMember(workspaceId, dto.assigneeId);
    if (dto.projectId) await this.assertProjectInWorkspace(workspaceId, dto.projectId);

    const data: Prisma.TicketUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
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

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: statusChanged ? ActivityAction.STATUS_CHANGED : ActivityAction.UPDATED,
      entity: ActivityEntity.TICKET,
      entityId: existing.id,
      summary: statusChanged
        ? `Moved ${updated.key} to ${humanize(dto.status as TicketStatus)}`
        : `Updated ${updated.key}`,
      metadata: { fields: Object.keys(data) },
    });

    const ticket = toTicketDto(updated);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TICKET_UPDATED, ticket);
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
    userId: string,
    query: TicketListQueryDto,
  ): Prisma.TicketWhereInput {
    // `me` saves a round trip to learn your own id, and makes a shared queue
    // link resolve per viewer.
    const assigneeId = query.assigneeId === 'me' ? userId : query.assigneeId;
    const reporterId = query.reporterId === 'me' ? userId : query.reporterId;

    // An explicit status filter speaks for itself; otherwise the queue hides
    // finished work unless the caller asks for it.
    const status = query.status?.length
      ? { in: query.status }
      : query.includeClosed
        ? undefined
        : { notIn: [...CLOSED_TICKET_STATUSES] };

    return {
      workspaceId,
      ...(status ? { status } : {}),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(reporterId ? { reporterId } : {}),
      ...(query.type?.length ? { type: { in: query.type } } : {}),
      ...(query.priority?.length ? { priority: { in: query.priority } } : {}),
      ...(query.severity?.length ? { severity: { in: query.severity } } : {}),
      ...(query.dueBefore ? { dueDate: { lte: new Date(query.dueBefore) } } : {}),
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
    userId: string,
  ): Promise<TicketListSummary> {
    const scope: Prisma.TicketWhereInput = {
      workspaceId,
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.assigneeId
        ? { assigneeId: query.assigneeId === 'me' ? userId : query.assigneeId }
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
  async requireTicket(workspaceId: string, idOrKey: string): Promise<PrismaTicket> {
    const ticket = await this.prisma.ticket.findFirst({
      where: { workspaceId, ...this.identify(idOrKey) },
    });

    if (!ticket) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Ticket not found.');
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

  private async assertProjectInWorkspace(workspaceId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true },
    });

    if (!project) {
      throw AppException.badRequest('BAD_REQUEST', 'That project is not in this workspace.');
    }
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
      actionUrl: `/tickets/${ticket.key}`,
    });
  }
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

function humanize(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}
