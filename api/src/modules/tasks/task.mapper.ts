import { TaskStatus } from '@coretask/contracts';
import type { Task, TaskDetail } from '@coretask/types';
import type { Prisma } from '@prisma/client';

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

/**
 * Subtask rollups come from a filtered relation count. Prisma cannot alias two
 * differently-filtered counts on the same relation, so "completed" is counted
 * separately in the service and passed in.
 */
export const taskInclude = {
  assignee: { select: USER_SELECT },
  _count: { select: { subtasks: true } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export const taskDetailInclude = {
  ...taskInclude,
  createdBy: { select: USER_SELECT },
  project: { select: { id: true, name: true, key: true, color: true } },
  section: { select: { id: true, name: true } },
  subtasks: {
    where: { archivedAt: null },
    orderBy: { position: 'asc' },
    include: taskInclude,
  },
} satisfies Prisma.TaskInclude;

export type TaskWithDetail = Prisma.TaskGetPayload<{ include: typeof taskDetailInclude }>;

export function toTaskDto(task: TaskWithRelations, completedSubtaskCount = 0): Task {
  return {
    id: task.id,
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    sectionId: task.sectionId,
    parentTaskId: task.parentTaskId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    position: task.position,
    startDate: task.startDate?.toISOString() ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    estimatedMinutes: task.estimatedMinutes,
    assigneeId: task.assigneeId,
    assignee: task.assignee,
    createdById: task.createdById,
    subtaskCount: task._count.subtasks,
    completedSubtaskCount,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export function toTaskDetailDto(task: TaskWithDetail): TaskDetail {
  const subtasks = task.subtasks.map((subtask) => toTaskDto(subtask));

  return {
    ...toTaskDto(task, subtasks.filter((subtask) => subtask.status === TaskStatus.DONE).length),
    subtasks,
    project: task.project,
    section: task.section,
    createdBy: task.createdBy,
  };
}
