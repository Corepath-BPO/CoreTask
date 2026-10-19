import { ApiRoutes } from '@coretask/contracts';
import type {
  PostProjectMessagePayload,
  PostStatusUpdatePayload,
  ProjectFile,
  ProjectMessage,
  ProjectStatusUpdate,
  StatusRequestResult,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

const routes = ApiRoutes.projectUpdates;

export const projectUpdatesApi = {
  latestStatus: (workspaceId: string): Promise<ProjectStatusUpdate[]> =>
    apiClient.get<ProjectStatusUpdate[]>(routes.latestStatus(workspaceId)),

  statusUpdates: (workspaceId: string, projectId: string): Promise<ProjectStatusUpdate[]> =>
    apiClient.get<ProjectStatusUpdate[]>(routes.statusUpdates(workspaceId, projectId)),

  requestStatusUpdate: (workspaceId: string, projectId: string): Promise<StatusRequestResult> =>
    apiClient.post<StatusRequestResult>(routes.requestStatus(workspaceId, projectId)),
  postStatusUpdate: (
    workspaceId: string,
    projectId: string,
    payload: PostStatusUpdatePayload,
  ): Promise<ProjectStatusUpdate> =>
    apiClient.post<ProjectStatusUpdate>(routes.statusUpdates(workspaceId, projectId), payload),

  deleteStatusUpdate: (workspaceId: string, projectId: string, updateId: string): Promise<void> =>
    apiClient.delete<void>(routes.statusUpdate(workspaceId, projectId, updateId)),

  messages: (workspaceId: string, projectId: string): Promise<ProjectMessage[]> =>
    apiClient.get<ProjectMessage[]>(routes.messages(workspaceId, projectId)),

  postMessage: (
    workspaceId: string,
    projectId: string,
    payload: PostProjectMessagePayload,
  ): Promise<ProjectMessage> =>
    apiClient.post<ProjectMessage>(routes.messages(workspaceId, projectId), payload),

  deleteMessage: (workspaceId: string, projectId: string, messageId: string): Promise<void> =>
    apiClient.delete<void>(routes.message(workspaceId, projectId, messageId)),

  reply: (
    workspaceId: string,
    projectId: string,
    messageId: string,
    body: string,
  ): Promise<ProjectMessage> =>
    apiClient.post<ProjectMessage>(routes.replies(workspaceId, projectId, messageId), { body }),

  files: (workspaceId: string, projectId: string): Promise<ProjectFile[]> =>
    apiClient.get<ProjectFile[]>(routes.files(workspaceId, projectId)),
};
