import {
  TASK_PRIORITY_DISPLAY,
  TASK_STATUS_DISPLAY,
  TICKET_PRIORITY_DISPLAY,
  TICKET_STATUS_DISPLAY,
  WorkItemType,
} from '@coretask/contracts';
import type { ProjectWorkItem, UserRef, WorkItemStateRef } from '@coretask/types';
import type { Prisma } from '@prisma/client';

/**
 * Turning two different records into one row.
 *
 * This is the whole point of the work-item layer: a task and a ticket differ in
 * identity, state vocabulary and history, and the grid that shows them does not
 * care about any of that. Everything type-specific ends up in `details`, so the
 * List can render a column without asking what backs the row.
 *
 * The mapping is deliberately one-way. Nothing here writes; a shape this
 * convenient to read is exactly the shape that hides which table an update has
 * to touch.
 */

const userRef = (
  user: { id: string; name: string; email: string; avatarUrl: string | null } | null,
): UserRef | null => (user ? { ...user } : null);

/** Everything the mapper needs from a task, and nothing it does not. */
export const workItemTaskInclude = {
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  createdBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
  statusDefinition: { select: { id: true, name: true, colorToken: true } },
  priorityDefinition: { select: { id: true, name: true, colorToken: true } },
  customFieldValues: true,
  _count: { select: { subtasks: { where: { archivedAt: null } } } },
} satisfies Prisma.TaskInclude;

export const workItemTicketInclude = {
  assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
  reporter: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.TicketInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof workItemTaskInclude }>;
type TicketRow = Prisma.TicketGetPayload<{ include: typeof workItemTicketInclude }>;

/**
 * A task's status, preferring the definition over the legacy enum.
 *
 * `Task.status` is still authoritative while the backfill is being verified, so
 * a task may carry no definition at all. Falling back to the enum means a row
 * always has something to draw rather than an empty cell that reads as "no
 * status" — which is a different thing entirely.
 */
function taskStatus(task: TaskRow): WorkItemStateRef {
  if (task.statusDefinition) {
    return {
      id: task.statusDefinition.id,
      name: task.statusDefinition.name,
      colorToken: task.statusDefinition.colorToken,
    };
  }

  const display = TASK_STATUS_DISPLAY[task.status];

  // The enum value is the id: it is what an update has to send back, and there
  // is no definition row to borrow a uuid from.
  return { id: task.status, name: display.name, colorToken: display.colorToken };
}

function taskPriority(task: TaskRow): WorkItemStateRef {
  if (task.priorityDefinition) {
    return {
      id: task.priorityDefinition.id,
      name: task.priorityDefinition.name,
      colorToken: task.priorityDefinition.colorToken,
    };
  }

  const display = TASK_PRIORITY_DISPLAY[task.priority];

  return { id: task.priority, name: display.name, colorToken: display.colorToken };
}

export function taskToWorkItem(task: TaskRow): ProjectWorkItem {
  return {
    id: task.id,
    type: WorkItemType.TASK,
    workspaceId: task.workspaceId,
    // Non-null by construction: only tasks belonging to a project are ever
    // read through here, and the query says so.
    projectId: task.projectId as string,
    sectionId: task.sectionId,
    parentId: task.parentTaskId,
    title: task.title,
    description: task.description,
    position: task.position,
    status: taskStatus(task),
    priority: taskPriority(task),
    // An array even though a task has one assignee. The contract allows several
    // because tickets and future types may; collapsing it here would make every
    // consumer handle two shapes.
    assignees: task.assignee ? [userRef(task.assignee) as UserRef] : [],
    startDate: task.startDate?.toISOString() ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    subtaskCount: task._count.subtasks,
    completedSubtaskCount: 0,
    customFieldValues: task.customFieldValues.map((value) => ({
      fieldId: value.customFieldId,
      textValue: value.textValue,
      numberValue: value.numberValue === null ? null : Number(value.numberValue),
      dateValue: value.dateValue?.toISOString() ?? null,
      booleanValue: value.booleanValue,
      optionIds: value.optionIds,
      userIds: value.userIds,
    })),
    details: { kind: 'TASK', estimatedMinutes: task.estimatedMinutes },
    createdById: task.createdById,
    createdBy: userRef(task.createdBy),
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function ticketToWorkItem(ticket: TicketRow): ProjectWorkItem {
  const status = TICKET_STATUS_DISPLAY[ticket.status];
  const priority = TICKET_PRIORITY_DISPLAY[ticket.priority];

  return {
    id: ticket.id,
    type: WorkItemType.TICKET,
    workspaceId: ticket.workspaceId,
    projectId: ticket.projectId as string,
    sectionId: ticket.sectionId,
    // Tickets have no hierarchy. Null rather than absent, so the field means
    // "no parent" in both cases rather than "this kind cannot have one".
    parentId: null,
    title: ticket.title,
    description: ticket.description,
    position: ticket.position,
    status: { id: ticket.status, name: status.name, colorToken: status.colorToken },
    priority: { id: ticket.priority, name: priority.name, colorToken: priority.colorToken },
    assignees: ticket.assignee ? [userRef(ticket.assignee) as UserRef] : [],
    startDate: null,
    dueDate: ticket.dueDate?.toISOString() ?? null,
    completedAt: ticket.resolvedAt?.toISOString() ?? null,
    archivedAt: ticket.archivedAt?.toISOString() ?? null,
    subtaskCount: 0,
    completedSubtaskCount: 0,
    /*
     * Always empty, and honestly so.
     *
     * `task_custom_field_values` is keyed to a task; there is nowhere to store a
     * ticket's. Returning an empty array rather than omitting the key keeps the
     * shape uniform — a consumer reads "no values", which is true — and the
     * List renders those cells read-only for tickets rather than pretending an
     * edit will stick. See docs/database/work-item-compatibility.md.
     */
    customFieldValues: [],
    details: {
      kind: 'TICKET',
      key: ticket.key,
      number: ticket.number,
      ticketType: ticket.type,
      severity: ticket.severity,
      reporter: userRef(ticket.reporter),
      rawStatus: ticket.status,
      rawPriority: ticket.priority,
      resolvedAt: ticket.resolvedAt?.toISOString() ?? null,
      closedAt: ticket.closedAt?.toISOString() ?? null,
    },
    // Tickets record a reporter rather than a creator. Using it here keeps the
    // "who put this here" column populated instead of blank for half the rows.
    createdById: ticket.reporterId ?? '',
    createdBy: userRef(ticket.reporter),
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

/**
 * One ordering across both kinds.
 *
 * Tasks and tickets share a section's position space, so a board column shows
 * one sequence rather than two interleaved ones. Ties fall back to id, which is
 * uuid v7 and therefore time-ordered — without it, two items created in the same
 * millisecond could swap places between requests.
 */
export function compareWorkItems(a: ProjectWorkItem, b: ProjectWorkItem): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id.localeCompare(b.id);
}
