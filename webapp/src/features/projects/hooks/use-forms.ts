import { ApiRoutes } from '@coretask/contracts';
import type { FormSubmission, ProjectForm, ProjectFormDraft, PublicForm } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.forms;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** The address a form is filled in at — what "Copy link" hands out. */
export function formLink(token: string): string {
  return `${window.location.origin}/forms/${token}`;
}

/** A project's intake forms, oldest first. */
export function useProjectForms(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.forms.list(workspaceId ?? '', projectId),
    queryFn: () => apiClient.get<ProjectForm[]>(routes.list(workspaceId as string, projectId)),
    enabled: Boolean(workspaceId && projectId),
  });
}

const refreshForms = (workspaceId: string, projectId: string) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.forms.list(workspaceId, projectId) });

export function useSaveForm(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ formId, draft }: { formId?: string; draft: Partial<ProjectFormDraft> }) =>
      formId
        ? apiClient.patch<ProjectForm>(
            routes.detail(workspaceId as string, projectId, formId),
            draft,
          )
        : apiClient.post<ProjectForm>(routes.list(workspaceId as string, projectId), draft),
    onSuccess: () => refreshForms(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not save the form.'),
  });
}

export function useDeleteForm(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (formId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, projectId, formId)),
    onSuccess: () => refreshForms(workspaceId as string, projectId),
    onError: (error) => report(error, 'Could not delete the form.'),
  });
}

/** A form as the public sees it. A closed or unknown link is an error, not a retry. */
export function usePublicForm(token: string) {
  return useQuery({
    queryKey: queryKeys.forms.public(token),
    queryFn: () => apiClient.get<PublicForm>(routes.public(token)),
    retry: false,
  });
}

export function useSubmitForm(token: string) {
  return useMutation({
    mutationFn: (submission: FormSubmission) =>
      apiClient.post<{ received: true }>(routes.submit(token), submission),
  });
}
