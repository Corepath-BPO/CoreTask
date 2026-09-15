import { ActivityEntity } from '@coretask/contracts';

/**
 * Which item a follower row, a story or a notification hangs off.
 *
 * Both columns are always named — a task link has `ticketId: null` — so the
 * shape doubles as an exact Prisma `where` and as `create` data, the same way
 * comments and attachments address their parent.
 */
export interface ItemLink {
  taskId: string | null;
  ticketId: string | null;
}

/** An item resolved inside its workspace, with what a notification needs to name it. */
export interface ItemRef {
  workspaceId: string;
  entity: typeof ActivityEntity.TASK | typeof ActivityEntity.TICKET;
  entityId: string;
  link: ItemLink;
  /** The project the item sits in — what decides who may be told about it. */
  projectId: string | null;
  /** `“Ship the grid”` for a task, `CORE-1042` for a ticket. */
  label: string;
  /** In-app path a notification opens. */
  actionUrl: string;
}

export const taskLink = (taskId: string): ItemLink => ({ taskId, ticketId: null });
export const ticketLink = (ticketId: string): ItemLink => ({ taskId: null, ticketId });

export function taskRef(
  workspaceId: string,
  task: { id: string; title: string; projectId: string | null },
): ItemRef {
  return {
    workspaceId,
    entity: ActivityEntity.TASK,
    entityId: task.id,
    link: taskLink(task.id),
    projectId: task.projectId,
    label: `“${task.title}”`,
    actionUrl: `/my-tasks?task=${task.id}`,
  };
}

export function ticketRef(
  workspaceId: string,
  ticket: { id: string; key: string; projectId: string | null },
): ItemRef {
  return {
    workspaceId,
    entity: ActivityEntity.TICKET,
    entityId: ticket.id,
    link: ticketLink(ticket.id),
    projectId: ticket.projectId,
    label: ticket.key,
    actionUrl: `/tickets?ticket=${ticket.key}`,
  };
}

/** The link for whichever id is set; a comment or attachment row carries both columns. */
export function linkOf(row: { taskId: string | null; ticketId: string | null }): ItemLink {
  return { taskId: row.taskId, ticketId: row.ticketId };
}
