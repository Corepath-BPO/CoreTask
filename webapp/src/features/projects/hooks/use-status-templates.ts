import { ApiRoutes } from '@coretask/contracts';
import type { StatusTemplate, StatusTemplateDraft } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.statusTemplates;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A project's status templates, by name. */
export function useStatusTemplates(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.statusTemplates.list(workspaceId ?? '', projectId),
    queryFn: () => apiClient.get<StatusTemplate[]>(routes.list(workspaceId as string, projectId)),
    enabled: Boolean(workspaceId && projectId),
  });
}

const refresh = (workspaceId: string, projectId: string) =>
  queryClient.invalidateQueries({
    queryKey: queryKeys.statusTemplates.list(workspaceId, projectId),
  });

export function useSaveStatusTemplate(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ templateId, draft }: { templateId?: string; draft: StatusTemplateDraft }) =>
      templateId
        ? apiClient.patch<StatusTemplate>(
            routes.detail(workspaceId as string, projectId, templateId),
            draft,
          )
        : apiClient.post<StatusTemplate>(routes.list(workspaceId as string, projectId), draft),
    onSuccess: () => refresh(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not save the template.'),
  });
}

export function useDeleteStatusTemplate(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (templateId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, projectId, templateId)),
    onSuccess: () => refresh(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not delete the template.'),
  });
}
