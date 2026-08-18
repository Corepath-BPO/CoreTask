import { ApiRoutes } from '@coretask/contracts';
import type {
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
};
