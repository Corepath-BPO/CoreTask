import { ApiRoutes } from '@coretask/contracts';
import type {
  CreateProjectTemplatePayload,
  DuplicateProjectPayload,
  ProjectTemplate,
  StartProjectPayload,
  StartedProject,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.projectTemplates;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** What a new project could not bring along, said once it exists. */
function warnAbout(started: StartedProject) {
  if (started.rulesNeedingAttention.length > 0) {
    const names = started.rulesNeedingAttention;
    toast.warning(
      `${names.join(', ')} ${names.length === 1 ? 'is a draft' : 'are drafts'} until ${names.length === 1 ? 'it is' : 'they are'} checked in the new project.`,
    );
  }
  if (started.rulesSkipped > 0) {
    toast.info(
      `${started.rulesSkipped} rule${started.rulesSkipped === 1 ? ' was' : 's were'} not copied: rules need a manager.`,
    );
  }
}

const refreshProjects = (workspaceId: string) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.projects.all(workspaceId) });

/** The workspace's project templates. */
export function useProjectTemplates(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projectTemplates.all(workspaceId ?? ''),
    queryFn: () => apiClient.get<ProjectTemplate[]>(routes.list(workspaceId as string)),
    enabled: Boolean(workspaceId),
  });
}

export function useSaveProjectTemplate(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateProjectTemplatePayload) =>
      apiClient.post<ProjectTemplate>(routes.list(workspaceId as string), payload),
    onSuccess: (template) => {
      toast.success(`Saved “${template.name}” as a template`);
      return queryClient.invalidateQueries({
        queryKey: queryKeys.projectTemplates.all(workspaceId as string),
      });
    },
    onError: (error) => report(error, 'Could not save the template.'),
  });
}

export function useDeleteProjectTemplate(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (templateId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, templateId)),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.projectTemplates.all(workspaceId as string),
      }),
    onError: (error) => report(error, 'Could not delete the template.'),
  });
}

/** A project from a template; resolves with the new project's id. */
export function useStartFromTemplate(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ templateId, payload }: { templateId: string; payload: StartProjectPayload }) =>
      apiClient.post<StartedProject>(routes.use(workspaceId as string, templateId), payload),
    onSuccess: async (started) => {
      warnAbout(started);
      await refreshProjects(workspaceId as string);
    },
    onError: (error) => report(error, 'Could not start the project.'),
  });
}

/** A copy of a project; resolves with the copy's id. */
export function useDuplicateProject(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ projectId, payload }: { projectId: string; payload: DuplicateProjectPayload }) =>
      apiClient.post<StartedProject>(routes.duplicate(workspaceId as string, projectId), payload),
    onSuccess: async (started) => {
      warnAbout(started);
      await refreshProjects(workspaceId as string);
    },
    onError: (error) => report(error, 'Could not duplicate the project.'),
  });
}
