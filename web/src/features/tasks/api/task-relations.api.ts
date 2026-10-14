import { ApiRoutes } from '@coretask/contracts';
import type { AddDependencyPayload, TaskDependencies, TaskLikes } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const taskRelationsApi = {
  likes: (workspaceId: string, taskId: string): Promise<TaskLikes> =>
    apiClient.get<TaskLikes>(ApiRoutes.tasks.likes(workspaceId, taskId)),

  like: (workspaceId: string, taskId: string): Promise<TaskLikes> =>
    apiClient.post<TaskLikes>(ApiRoutes.tasks.likes(workspaceId, taskId)),

  unlike: (workspaceId: string, taskId: string): Promise<TaskLikes> =>
    apiClient.delete<TaskLikes>(ApiRoutes.tasks.likes(workspaceId, taskId)),

  dependencies: (workspaceId: string, taskId: string): Promise<TaskDependencies> =>
    apiClient.get<TaskDependencies>(ApiRoutes.tasks.dependencies(workspaceId, taskId)),

  addDependency: (
    workspaceId: string,
    taskId: string,
    payload: AddDependencyPayload,
  ): Promise<TaskDependencies> =>
    apiClient.post<TaskDependencies>(ApiRoutes.tasks.dependencies(workspaceId, taskId), payload),

  removeDependency: (
    workspaceId: string,
    taskId: string,
    dependencyId: string,
  ): Promise<TaskDependencies> =>
    apiClient.delete<TaskDependencies>(
      ApiRoutes.tasks.dependency(workspaceId, taskId, dependencyId),
    ),
};
