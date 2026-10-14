import { ApiRoutes } from '@coretask/contracts';
import type {
  AddTaskTagPayload,
  CreateTagPayload,
  Tag,
  TagRef,
  UpdateTagPayload,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.tags;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** The workspace's tags, alphabetical, each with how many tasks carry it. */
export function useTags(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.tags.all(workspaceId ?? ''),
    queryFn: () => apiClient.get<Tag[]>(routes.list(workspaceId as string)),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}

/**
 * A tag change shows up on every task that carries it — panels, List rows,
 * Board cards — and in the filter's options, so all of those are refreshed.
 */
function refreshEverywhere(workspaceId: string) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.tags.all(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: ['work-items', workspaceId] });
  void queryClient.invalidateQueries({ queryKey: ['project-views', workspaceId] });
}

export function useCreateTag(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: CreateTagPayload) =>
      apiClient.post<Tag>(routes.list(workspaceId as string), payload),
    onSuccess: () => refreshEverywhere(workspaceId as string),
    onError: (error) => report(error, 'Could not make the tag.'),
  });
}

export function useUpdateTag(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ tagId, payload }: { tagId: string; payload: UpdateTagPayload }) =>
      apiClient.patch<Tag>(routes.detail(workspaceId as string, tagId), payload),
    onSuccess: () => refreshEverywhere(workspaceId as string),
    onError: (error) => report(error, 'Could not change the tag.'),
  });
}

export function useDeleteTag(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (tagId: string) =>
      apiClient.delete<void>(routes.detail(workspaceId as string, tagId)),
    onSuccess: () => refreshEverywhere(workspaceId as string),
    onError: (error) => report(error, 'Could not delete the tag.'),
  });
}

/** Tag a task by id, or by a name — which makes the tag if it is new. */
export function useAddTaskTag(workspaceId: string | undefined, taskId: string) {
  return useMutation({
    mutationFn: (payload: AddTaskTagPayload) =>
      apiClient.post<TagRef[]>(routes.onTask(workspaceId as string, taskId), payload),
    onSuccess: () => refreshEverywhere(workspaceId as string),
    onError: (error) => report(error, 'Could not add the tag.'),
  });
}

export function useRemoveTaskTag(workspaceId: string | undefined, taskId: string) {
  return useMutation({
    mutationFn: (tagId: string) =>
      apiClient.delete<TagRef[]>(routes.onTaskDetail(workspaceId as string, taskId, tagId)),
    onSuccess: () => refreshEverywhere(workspaceId as string),
    onError: (error) => report(error, 'Could not remove the tag.'),
  });
}
