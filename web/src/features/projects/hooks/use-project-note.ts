import { ApiRoutes } from '@coretask/contracts';
import type { ProjectNote } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

/** The project's Note, and who changed it last. */
export function useProjectNote(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projects.note(workspaceId ?? '', projectId),
    queryFn: () =>
      apiClient.get<ProjectNote>(ApiRoutes.projectNote(workspaceId as string, projectId)),
    enabled: Boolean(workspaceId && projectId),
  });
}

export function useSaveProjectNote(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (body: string) =>
      apiClient.put<ProjectNote>(ApiRoutes.projectNote(workspaceId as string, projectId), { body }),
    onSuccess: (note) =>
      queryClient.setQueryData(queryKeys.projects.note(workspaceId as string, projectId), note),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save the note.'),
  });
}
