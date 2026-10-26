import { ApiRoutes } from '@coretask/contracts';
import type {
  AddTaskToProjectPayload,
  CreateTaskPayload,
  MoveTaskPayload,
  Task,
  TaskDetail,
  TaskListMeta,
  UpdateTaskPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export interface TaskListParams {
  page?: number;
  limit?: number;
  projectId?: string;
  sectionId?: string;
  /** `me` resolves to the caller server-side. */
  assigneeId?: string;
  status?: string[];
  priority?: string[];
  search?: string;
  dueBefore?: string;
  dueAfter?: string;
  includeArchived?: boolean;
  includeSubtasks?: boolean;
  /** Only tasks of this kind — the Overview's milestones. */
  kind?: string;
}

export const tasksApi = {
  list: (
    workspaceId: string,
    params: TaskListParams = {},
  ): Promise<{ items: Task[]; meta: TaskListMeta }> =>
    apiClient.getPaginated<Task, TaskListMeta>(ApiRoutes.tasks.list(workspaceId), {
      params,
      // Arrays go out as repeated keys (`?status=A&status=B`) rather than
      // axios's default bracket notation, which the API does not parse.
      paramsSerializer: { indexes: null },
    }),

  get: (workspaceId: string, taskId: string): Promise<TaskDetail> =>
    apiClient.get<TaskDetail>(ApiRoutes.tasks.detail(workspaceId, taskId)),

  create: (workspaceId: string, payload: CreateTaskPayload): Promise<Task> =>
    apiClient.post<Task>(ApiRoutes.tasks.create(workspaceId), payload),

  update: (workspaceId: string, taskId: string, payload: UpdateTaskPayload): Promise<Task> =>
    apiClient.patch<Task>(ApiRoutes.tasks.update(workspaceId, taskId), payload),

  move: (workspaceId: string, taskId: string, payload: MoveTaskPayload): Promise<Task> =>
    apiClient.patch<Task>(ApiRoutes.tasks.move(workspaceId, taskId), payload),

  archive: (workspaceId: string, taskId: string): Promise<Task> =>
    apiClient.delete<Task>(ApiRoutes.tasks.archive(workspaceId, taskId)),

  restore: (workspaceId: string, taskId: string): Promise<Task> =>
    apiClient.post<Task>(ApiRoutes.tasks.restore(workspaceId, taskId)),

  /** Multi-homing: another project the task is in. */
  addToProject: (
    workspaceId: string,
    taskId: string,
    payload: AddTaskToProjectPayload,
  ): Promise<TaskDetail> =>
    apiClient.post<TaskDetail>(ApiRoutes.tasks.projects(workspaceId, taskId), payload),

  setProjectSection: (
    workspaceId: string,
    taskId: string,
    projectId: string,
    sectionId: string | null,
  ): Promise<TaskDetail> =>
    apiClient.patch<TaskDetail>(ApiRoutes.tasks.project(workspaceId, taskId, projectId), {
      sectionId,
    }),

  /** Null when the caller can no longer see the task afterwards. */
  removeFromProject: (
    workspaceId: string,
    taskId: string,
    projectId: string,
  ): Promise<TaskDetail | null> =>
    apiClient.delete<TaskDetail | null>(ApiRoutes.tasks.project(workspaceId, taskId, projectId)),
};
