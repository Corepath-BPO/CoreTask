import { ApiRoutes } from '@coretask/contracts';
import type {
  CreateProjectAppPayload,
  ProjectAppConnection,
  UpdateProjectAppPayload,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.projectApps;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** The chat apps a project posts to, oldest first. */
export function useProjectApps(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectApps.list(workspaceId ?? '', projectId),
    queryFn: () =>
      apiClient.get<ProjectAppConnection[]>(routes.list(workspaceId as string, projectId)),
    enabled: Boolean(workspaceId && projectId),
  });
}

const refresh = (workspaceId: string, projectId: string) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.projectApps.list(workspaceId, projectId) });

export function useConnectProjectApp(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: CreateProjectAppPayload) =>
      apiClient.post<ProjectAppConnection>(routes.list(workspaceId as string, projectId), payload),
    onSuccess: (app) => {
      void refresh(workspaceId as string, projectId);
      toast.success(`Connected. A hello is on its way to ${app.name}.`);
    },
    onError: (error) => report(error, 'Could not connect the app.'),
  });
}

export function useUpdateProjectApp(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ appId, payload }: { appId: string; payload: UpdateProjectAppPayload }) =>
      apiClient.patch<ProjectAppConnection>(
        routes.detail(workspaceId as string, projectId, appId),
        payload,
      ),
    onSuccess: () => refresh(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not save the app.'),
  });
}

export function useDisconnectProjectApp(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (appId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, projectId, appId)),
    onSuccess: () => refresh(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not disconnect the app.'),
  });
}

export function useTestProjectApp(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (appId: string) =>
      apiClient.post<{ deliveryId: string }>(routes.test(workspaceId as string, projectId, appId)),
    onSuccess: () => {
      toast.success('Test message sent.');
      // The send happens in the background; its result lands on the row shortly.
      window.setTimeout(() => void refresh(workspaceId as string, projectId), 3_000);
    },
    onError: (error) => report(error, 'Could not send a test message.'),
  });
}
