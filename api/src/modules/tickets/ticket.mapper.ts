import type { Ticket, TicketDetail } from '@coretask/types';
import type { Prisma } from '@prisma/client';

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

export const ticketInclude = {
  reporter: { select: USER_SELECT },
  assignee: { select: USER_SELECT },
} satisfies Prisma.TicketInclude;

export type TicketWithRelations = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

export const ticketDetailInclude = {
  ...ticketInclude,
  project: { select: { id: true, name: true, key: true, color: true } },
} satisfies Prisma.TicketInclude;

export type TicketWithDetail = Prisma.TicketGetPayload<{ include: typeof ticketDetailInclude }>;

export function toTicketDto(ticket: TicketWithRelations): Ticket {
  return {
    id: ticket.id,
    workspaceId: ticket.workspaceId,
    projectId: ticket.projectId,
    number: ticket.number,
    key: ticket.key,
    title: ticket.title,
    description: ticket.description,
    type: ticket.type,
    status: ticket.status,
    priority: ticket.priority,
    severity: ticket.severity,
    reporterId: ticket.reporterId,
    reporter: ticket.reporter,
    assigneeId: ticket.assigneeId,
    assignee: ticket.assignee,
    dueDate: ticket.dueDate?.toISOString() ?? null,
    resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

export function toTicketDetailDto(ticket: TicketWithDetail): TicketDetail {
  return { ...toTicketDto(ticket), project: ticket.project };
}
