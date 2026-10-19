import { ApiRoutes, type StatusCategory } from '@coretask/contracts';
import type { PriorityDefinition, StatusDefinition } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.definitions;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/**
 * A status or a priority shows on every row, card and filter, so a change to
 * one refreshes the project's views as well as the list it came from.
 */
function refresh(workspaceId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.definitions.all(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: ['project-views', workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ['work-items', workspaceId] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) });
}

export function useProjectStatuses(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.definitions.statuses(workspaceId ?? '', projectId),
    queryFn: () =>
      apiClient.get<StatusDefinition[]>(routes.statuses(workspaceId as string, projectId)),
    enabled: Boolean(workspaceId && projectId),
  });
}

export function usePriorities(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.definitions.priorities(workspaceId ?? ''),
    queryFn: () => apiClient.get<PriorityDefinition[]>(routes.priorities(workspaceId as string)),
    enabled: Boolean(workspaceId),
  });
}

export interface StatusDraft {
  name?: string;
  category?: StatusCategory;
  colorToken?: string;
  isArchived?: boolean;
}

export function useSaveStatus(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ statusId, draft }: { statusId?: string; draft: StatusDraft }) =>
      statusId
        ? apiClient.patch<StatusDefinition>(
            routes.status(workspaceId as string, projectId, statusId),
            draft,
          )
        : apiClient.post<StatusDefinition>(
            routes.statuses(workspaceId as string, projectId),
            draft,
          ),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not save the status.'),
  });
}

export function useDeleteStatus(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (statusId: string) =>
      apiClient.delete<{ deleted: true }>(
        routes.status(workspaceId as string, projectId, statusId),
      ),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not delete the status.'),
  });
}

export function useReorderStatuses(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.post<StatusDefinition[]>(routes.reorderStatuses(workspaceId as string, projectId), {
        ids,
      }),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not reorder the statuses.'),
  });
}

export interface PriorityDraft {
  name?: string;
  level?: number;
  colorToken?: string;
  isArchived?: boolean;
}

export function useSavePriority(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ priorityId, draft }: { priorityId?: string; draft: PriorityDraft }) =>
      priorityId
        ? apiClient.patch<PriorityDefinition>(
            routes.priority(workspaceId as string, priorityId),
            draft,
          )
        : apiClient.post<PriorityDefinition>(routes.priorities(workspaceId as string), draft),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not save the priority.'),
  });
}

export function useDeletePriority(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (priorityId: string) =>
      apiClient.delete<{ deleted: true }>(routes.priority(workspaceId as string, priorityId)),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not delete the priority.'),
  });
}

export function useReorderPriorities(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (ids: string[]) =>
      apiClient.post<PriorityDefinition[]>(routes.reorderPriorities(workspaceId as string), {
        ids,
      }),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not reorder the priorities.'),
  });
}
