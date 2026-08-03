import { ApiRoutes } from '@coretask/contracts';
import type {
  CreateWorkspacePayload,
  UpdateWorkspacePayload,
  WorkspaceMember,
  WorkspaceSummary,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const workspacesApi = {
  list: (): Promise<WorkspaceSummary[]> =>
    apiClient.get<WorkspaceSummary[]>(ApiRoutes.workspaces.list),

  create: (payload: CreateWorkspacePayload): Promise<WorkspaceSummary> =>
    apiClient.post<WorkspaceSummary>(ApiRoutes.workspaces.create, payload),

  get: (workspaceId: string): Promise<WorkspaceSummary> =>
    apiClient.get<WorkspaceSummary>(ApiRoutes.workspaces.detail(workspaceId)),

  update: (workspaceId: string, payload: UpdateWorkspacePayload): Promise<WorkspaceSummary> =>
    apiClient.patch<WorkspaceSummary>(ApiRoutes.workspaces.update(workspaceId), payload),

  members: (workspaceId: string): Promise<WorkspaceMember[]> =>
    apiClient.get<WorkspaceMember[]>(ApiRoutes.workspaces.members(workspaceId)),
};
