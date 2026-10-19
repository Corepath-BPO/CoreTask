import { ApiRoutes } from '@coretask/contracts';
import type { AddProjectResourcePayload, ProjectResource } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** The project's key resources, in the order they were added. */
export function useProjectResources(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projects.resources(workspaceId ?? '', projectId),
    queryFn: () =>
      apiClient.get<ProjectResource[]>(
        ApiRoutes.projectResources(workspaceId as string, projectId),
      ),
    enabled: Boolean(workspaceId && projectId),
  });
}

/** Every write answers with the whole list. */
const store = (workspaceId: string, projectId: string) => (resources: ProjectResource[]) =>
  queryClient.setQueryData(queryKeys.projects.resources(workspaceId, projectId), resources);

export function useAddProjectResource(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: AddProjectResourcePayload) =>
      apiClient.post<ProjectResource[]>(
        ApiRoutes.projectResources(workspaceId as string, projectId),
        payload,
      ),
    onSuccess: store(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not add the link.'),
  });
}

export function useRemoveProjectResource(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (resourceId: string) =>
      apiClient.delete<ProjectResource[]>(
        ApiRoutes.projectResource(workspaceId as string, projectId, resourceId),
      ),
    onSuccess: store(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not remove the link.'),
  });
}
