import type {
  CreateWorkItemPayload,
  ProjectWorkItem,
  ProjectWorkItemQuery,
  UpdateWorkItemPayload,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { Prisma, TicketPriority, TicketStatus } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import { PrismaService } from '../../../database/prisma.service';
import { ticketToWorkItem, workItemTicketInclude } from '../lib/work-item.mapper';

type TicketRow = Prisma.TicketGetPayload<{ include: typeof workItemTicketInclude }>;

const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/** Statuses that mean the work is finished, for the timestamps below. */
const RESOLVED_STATUSES = new Set<TicketStatus>([TicketStatus.RESOLVED, TicketStatus.CLOSED]);

/**
 * The ticket half of a work item.
 *
 * A ticket differs from a task in the ways that matter to whoever filed it: it
 * has a key somebody has already quoted in an email, a severity, a reporter, and
 * a lifecycle with resolved and closed timestamps. None of that survives being
 * flattened into a task, which is why the tables stay separate and this exists.
 */
@Injectable()
export class TicketWorkItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    workspaceId: string,
    projectId: string,
    query: ProjectWorkItemQuery,
  ): Promise<TicketRow[]> {
    return this.prisma.ticket.findMany({
      where: {
        workspaceId,
        projectId,
        ...(query.includeArchived ? {} : { archivedAt: null }),
        ...(query.sectionId === undefined ? {} : { sectionId: query.sectionId }),
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
                // The key too: pasting `CORE-1042` is how people look for one.
                { key: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              ],
            }
          : {}),
      },
      include: workItemTicketInclude,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: (query.limit ?? 200) + 1,
    });
  }

  async create(
    workspaceId: string,
    projectId: string,
    userId: string,
    payload: CreateWorkItemPayload,
    sectionId: string | null,
    position: number,
  ): Promise<ProjectWorkItem> {
    if (payload.parentId) {
      // Tickets have no hierarchy. Accepting the id and ignoring it would let
      // somebody believe they filed a subticket that does not exist.
      throw AppException.badRequest('BAD_REQUEST', 'A ticket cannot be a subtask.');
    }

    await this.assertAssigneesAreMembers(workspaceId, payload.assigneeIds);

    const status = this.readStatus(payload.statusId) ?? TicketStatus.OPEN;

    const created = await this.prisma.$transaction(async (tx) => {
      /*
       * The key is allocated the same way the tickets module does it, and for
       * the same reason: `update … increment` takes a row lock on the workspace,
       * so two concurrent creates serialise here instead of both reading the
       * same counter and racing to insert the same key.
       *
       * Deliberately not extracted into a shared helper yet — it has to run
       * inside *this* transaction, and passing a transaction client around to
       * share six lines buys less than it costs to follow.
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
          projectId,
          sectionId,
          position,
          number,
          key: `${workspace.ticketPrefix}-${number}`,
          title: payload.title,
          description: payload.description ?? null,
          status,
          ...(this.readPriority(payload.priorityId)
            ? { priority: this.readPriority(payload.priorityId) as TicketPriority }
            : {}),
          reporterId: userId,
          assigneeId: payload.assigneeIds?.[0] ?? null,
          dueDate: toDate(payload.dueDate) ?? null,
          ...(RESOLVED_STATUSES.has(status) ? { resolvedAt: new Date() } : {}),
        },
        include: workItemTicketInclude,
      });
    });

    return ticketToWorkItem(created);
  }

  async update(
    workspaceId: string,
    ticketId: string,
    payload: UpdateWorkItemPayload,
  ): Promise<ProjectWorkItem> {
    await this.assertAssigneesAreMembers(workspaceId, payload.assigneeIds);

    const current = await this.prisma.ticket.findFirstOrThrow({
      where: { id: ticketId, workspaceId },
      select: { status: true, resolvedAt: true, closedAt: true },
    });

    const status = this.readStatus(payload.statusId);

    const updated = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: {
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.description === undefined ? {} : { description: payload.description }),
        ...(status ? { status } : {}),
        ...(this.readPriority(payload.priorityId)
          ? { priority: this.readPriority(payload.priorityId) as TicketPriority }
          : {}),
        ...(payload.assigneeIds === undefined
          ? {}
          : { assigneeId: payload.assigneeIds[0] ?? null }),
        ...(payload.dueDate === undefined ? {} : { dueDate: toDate(payload.dueDate) }),
        ...(status ? this.lifecycle(status, current) : {}),
      },
      include: workItemTicketInclude,
    });

    return ticketToWorkItem(updated);
  }

  async move(
    workspaceId: string,
    ticketId: string,
    sectionId: string | null,
    position: number,
  ): Promise<ProjectWorkItem> {
    const moved = await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { sectionId, position },
      include: workItemTicketInclude,
    });

    /*
     * A section's default status is deliberately *not* applied to a ticket.
     *
     * `Section.defaultStatusId` points at a `StatusDefinition` — a task status.
     * A ticket's status is its own enum with its own meaning: "resolved" carries
     * a resolution somebody is accountable for. Mapping one onto the other by
     * position in a list is guesswork, and the wrong guess silently closes a
     * customer's ticket. Moving a ticket moves it; the status is changed on
     * purpose or not at all.
     */
    return ticketToWorkItem(moved);
  }

  /** `null` when nothing was sent; throws when what was sent is not a status. */
  private readStatus(statusId: string | null | undefined): TicketStatus | null {
    if (!statusId) return null;

    if (!(statusId in TicketStatus)) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `"${statusId}" is not a ticket status. Expected one of ${Object.keys(TicketStatus).join(', ')}.`,
      );
    }

    return statusId as TicketStatus;
  }

  private readPriority(priorityId: string | null | undefined): TicketPriority | null {
    if (!priorityId) return null;

    if (!(priorityId in TicketPriority)) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `"${priorityId}" is not a ticket priority. Expected one of ${Object.keys(TicketPriority).join(', ')}.`,
      );
    }

    return priorityId as TicketPriority;
  }

  /**
   * `resolvedAt` and `closedAt` follow the status; they are never set directly.
   *
   * Reopening clears them, so a ticket that went out and came back does not
   * keep claiming it was resolved on a date it plainly was not.
   */
  private lifecycle(
    status: TicketStatus,
    current: { resolvedAt: Date | null; closedAt: Date | null },
  ): { resolvedAt: Date | null; closedAt: Date | null } {
    const now = new Date();

    if (status === TicketStatus.CLOSED) {
      return {
        resolvedAt: current.resolvedAt ?? now,
        closedAt: current.closedAt ?? now,
      };
    }

    if (status === TicketStatus.RESOLVED) {
      return { resolvedAt: current.resolvedAt ?? now, closedAt: null };
    }

    return { resolvedAt: null, closedAt: null };
  }

  private async assertAssigneesAreMembers(
    workspaceId: string,
    assigneeIds: string[] | undefined,
  ): Promise<void> {
    if (!assigneeIds?.length) return;

    const count = await this.prisma.workspaceMember.count({
      where: { workspaceId, userId: { in: assigneeIds } },
    });

    if (count !== new Set(assigneeIds).size) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'An assignee is not a member of this workspace.',
      );
    }
  }
}
