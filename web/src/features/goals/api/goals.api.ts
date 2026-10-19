import { ApiRoutes } from '@coretask/contracts';
import type { CreateGoalPayload, Goal, UpdateGoalPayload } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const goalsApi = {
  list: (workspaceId: string) => apiClient.get<Goal[]>(ApiRoutes.goals.list(workspaceId)),

  create: (workspaceId: string, payload: CreateGoalPayload) =>
    apiClient.post<Goal>(ApiRoutes.goals.list(workspaceId), payload),

  update: (workspaceId: string, goalId: string, payload: UpdateGoalPayload) =>
    apiClient.patch<Goal>(ApiRoutes.goals.detail(workspaceId, goalId), payload),

  remove: (workspaceId: string, goalId: string) =>
    apiClient.delete<void>(ApiRoutes.goals.detail(workspaceId, goalId)),

  linkProject: (workspaceId: string, goalId: string, projectId: string) =>
    apiClient.put<Goal>(ApiRoutes.goals.project(workspaceId, goalId, projectId)),

  unlinkProject: (workspaceId: string, goalId: string, projectId: string) =>
    apiClient.delete<Goal>(ApiRoutes.goals.project(workspaceId, goalId, projectId)),
};
