import { ApiRoutes } from '@coretask/contracts';
import type { Task, TaskTemplate, TaskTemplateDraft } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.taskTemplates;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A project's task templates, by name. */
export function useTaskTemplates(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.taskTemplates.list(workspaceId ?? '', projectId),
    queryFn: () => apiClient.get<TaskTemplate[]>(routes.list(workspaceId as string, projectId)),
    enabled: Boolean(workspaceId && projectId),
  });
}

const refreshTemplates = (workspaceId: string, projectId: string) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.taskTemplates.list(workspaceId, projectId) });

export function useSaveTaskTemplate(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ templateId, draft }: { templateId?: string; draft: TaskTemplateDraft }) =>
      templateId
        ? apiClient.patch<TaskTemplate>(
            routes.detail(workspaceId as string, projectId, templateId),
            draft,
          )
        : apiClient.post<TaskTemplate>(routes.list(workspaceId as string, projectId), draft),
    onSuccess: () => refreshTemplates(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not save the template.'),
  });
}

export function useDeleteTaskTemplate(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (templateId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, projectId, templateId)),
    onSuccess: () => refreshTemplates(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not delete the template.'),
  });
}

/** Creates a task, with its subtasks, from a template; every list showing tasks refreshes. */
export function useUseTaskTemplate(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ templateId, sectionId }: { templateId: string; sectionId?: string | null }) =>
      apiClient.post<Task>(routes.use(workspaceId as string, projectId, templateId), {
        ...(sectionId ? { sectionId } : {}),
      }),
    onSuccess: async (task) => {
      toast.success(`Created “${task.title}”`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId as string) }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.workItems.all(workspaceId as string, projectId),
        }),
      ]);
    },
    onError: (error) => report(error, 'Could not create the task.'),
  });
}
