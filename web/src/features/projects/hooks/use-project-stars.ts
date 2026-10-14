import { ApiRoutes } from '@coretask/contracts';
import type { StarredProject } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const starsApi = {
  list: (workspaceId: string) =>
    apiClient.get<StarredProject[]>(ApiRoutes.starredProjects(workspaceId)),
  star: (workspaceId: string, projectId: string) =>
    apiClient.put<StarredProject[]>(ApiRoutes.projectStar(workspaceId, projectId)),
  unstar: (workspaceId: string, projectId: string) =>
    apiClient.delete<StarredProject[]>(ApiRoutes.projectStar(workspaceId, projectId)),
};

export function useStarredProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.starred(workspaceId ?? ''),
    queryFn: () => starsApi.list(workspaceId as string),
    enabled: Boolean(workspaceId),
    // The sidebar reads this on every page; it changes only when the reader
    // stars something, which writes the answer straight into the cache.
    staleTime: 5 * 60_000,
  });
}

/** Whether a project is starred, and the toggle — for a header or a row. */
export function useProjectStar(workspaceId: string | undefined, projectId: string) {
  const { data } = useStarredProjects(workspaceId);
  const starred = data?.some((project) => project.id === projectId) ?? false;
  const key = queryKeys.projects.starred(workspaceId ?? '');

  const toggle = useMutation({
    mutationFn: (next: boolean) =>
      next
        ? starsApi.star(workspaceId as string, projectId)
        : starsApi.unstar(workspaceId as string, projectId),
    onSuccess: (list) => queryClient.setQueryData(key, list),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change the star.'),
  });

  return {
    starred,
    pending: toggle.isPending,
    toggle: () => toggle.mutate(!starred),
  };
}
