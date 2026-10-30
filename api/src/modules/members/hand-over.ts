import { CLOSED_TASK_STATUSES, CLOSED_TICKET_STATUSES, WorkspaceRole } from '@coretask/contracts';
import type { Prisma } from '@prisma/client';

export interface HandOverCounts {
  tasksReassigned: number;
  ticketsReassigned: number;
  tasksUnassigned: number;
  ticketsUnassigned: number;
}

/**
 * Takes someone's open tasks and tickets off them as their access ends: to
 * the member a super admin named, where that member may be given the work,
 * and unassigned otherwise. Asana's deprovisioning does the same hand-over.
 *
 * Only open work. A finished task records who did it, and rewriting that
 * would falsify history; the same goes for comments and reported tickets.
 *
 * Runs in the caller's transaction, so the hand-over and the end of access
 * can never disagree.
 */
export async function handOverOpenWork(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    fromUserId: string;
    to: { userId: string; role: WorkspaceRole } | null;
  },
): Promise<HandOverCounts> {
  const { workspaceId, fromUserId, to } = input;
  const openTasks: Prisma.TaskWhereInput = {
    workspaceId,
    assigneeId: fromUserId,
    status: { notIn: [...CLOSED_TASK_STATUSES] },
  };
  const openTickets: Prisma.TicketWhereInput = {
    workspaceId,
    assigneeId: fromUserId,
    status: { notIn: [...CLOSED_TICKET_STATUSES] },
  };

  let tasksReassigned = 0;
  let ticketsReassigned = 0;

  if (to) {
    // The assignee rule of `project-access/assignable.ts`: work in a project
    // goes to its members, a task linked into another project to a member of
    // either, and anything to the owner. Work in no project goes to anyone.
    const anywhere = to.role === WorkspaceRole.OWNER;
    const member: Prisma.ProjectWhereInput = { members: { some: { userId: to.userId } } };
    const taskWhere: Prisma.TaskWhereInput = anywhere
      ? {}
      : {
          OR: [
            { projectId: null },
            { project: member },
            { projectLinks: { some: { project: member } } },
          ],
        };
    const ticketWhere: Prisma.TicketWhereInput = anywhere
      ? {}
      : { OR: [{ projectId: null }, { project: member }] };

    tasksReassigned = (
      await tx.task.updateMany({
        where: { ...openTasks, ...taskWhere },
        data: { assigneeId: to.userId },
      })
    ).count;
    ticketsReassigned = (
      await tx.ticket.updateMany({
        where: { ...openTickets, ...ticketWhere },
        data: { assigneeId: to.userId },
      })
    ).count;
  }

  const tasks = await tx.task.updateMany({ where: openTasks, data: { assigneeId: null } });
  const tickets = await tx.ticket.updateMany({ where: openTickets, data: { assigneeId: null } });

  return {
    tasksReassigned,
    ticketsReassigned,
    tasksUnassigned: tasks.count,
    ticketsUnassigned: tickets.count,
  };
}
