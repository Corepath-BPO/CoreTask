import { TaskStatus } from '@coretask/contracts';
import type { Task, TaskDetail } from '@coretask/types';
import type { Prisma } from '@prisma/client';

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

/**
 * Subtask rollups come from a filtered relation count. Prisma cannot alias two
 * differently-filtered counts on the same relation, so "completed" is counted
 * separately in the service and passed in.
 *
 * `archivedAt: null` matters: the count was unfiltered while the completed
 * count beside it was not, so archiving a subtask left every "2/5" in the app
 * claiming work that no longer exists. It only became obvious once a row could
 * be expanded and the rows underneath counted.
 */
export const taskInclude = {
  assignee: { select: USER_SELECT },
  _count: {
    select: {
      subtasks: { where: { archivedAt: null } },
      // Live conversation and confirmed files: the bubble and clip a row shows.
      comments: { where: { deletedAt: null } },
      attachments: { where: { status: 'READY' } },
    },
  },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export const taskDetailInclude = {
  ...taskInclude,
  createdBy: { select: USER_SELECT },
  project: { select: { id: true, name: true, key: true, color: true } },
  section: { select: { id: true, name: true } },
  subtasks: {
    where: { archivedAt: null },
    // The id as tiebreak, because rows written before positions were set all
    // share 0 — and ids are time-ordered, so a tie reads in creation order
    // instead of whatever order the database felt like.
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
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
    startAt: task.startAt?.toISOString() ?? null,
    dueDate: task.dueDate?.toISOString() ?? null,
    dueAt: task.dueAt?.toISOString() ?? null,
    completedAt: task.completedAt?.toISOString() ?? null,
    archivedAt: task.archivedAt?.toISOString() ?? null,
    estimatedMinutes: task.estimatedMinutes,
    assigneeId: task.assigneeId,
    assignee: task.assignee,
    createdById: task.createdById,
    subtaskCount: task._count.subtasks,
    completedSubtaskCount,
    commentCount: task._count.comments,
    attachmentCount: task._count.attachments,
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
