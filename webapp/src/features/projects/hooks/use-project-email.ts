import { ApiRoutes } from '@coretask/contracts';
import type { ProjectEmailSettings, UpdateProjectEmailPayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.projectEmail;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A project's email address, its handling, and the mail it last received. */
export function useProjectEmail(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectEmail.settings(workspaceId ?? '', projectId),
    queryFn: () =>
      apiClient.get<ProjectEmailSettings>(routes.settings(workspaceId as string, projectId)),
    enabled: Boolean(workspaceId && projectId),
  });
}

/** Every write answers with the settings as they now are. */
const store = (workspaceId: string, projectId: string) => (settings: ProjectEmailSettings) =>
  queryClient.setQueryData(queryKeys.projectEmail.settings(workspaceId, projectId), settings);

export function useUpdateProjectEmail(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: UpdateProjectEmailPayload) =>
      apiClient.patch<ProjectEmailSettings>(
        routes.settings(workspaceId as string, projectId),
        payload,
      ),
    onSuccess: store(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not save the email settings.'),
  });
}

export function useResetProjectEmail(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: () =>
      apiClient.post<ProjectEmailSettings>(routes.resetAddress(workspaceId as string, projectId)),
    onSuccess: (settings) => {
      store(workspaceId as string, projectId)(settings);
      toast.success('The project has a new address.');
    },
    onError: (error) => report(error, 'Could not give the project a new address.'),
  });
}
