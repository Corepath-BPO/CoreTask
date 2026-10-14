import {
  ApiRoutes,
  DEFAULT_MY_TASKS_RULES,
  type MyTasksBucket,
  type MyTasksRules,
} from '@coretask/contracts';
import type { MyTaskPlacement } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient } from '@/lib/api/query-client';

const key = (workspaceId: string) => ['my-task-placements', workspaceId] as const;

export function useMyTaskPlacements(workspaceId: string | undefined) {
  return useQuery({
    queryKey: key(workspaceId ?? ''),
    queryFn: () =>
      apiClient.get<MyTaskPlacement[]>(ApiRoutes.myTaskPlacements(workspaceId as string)),
    enabled: Boolean(workspaceId),
  });
}

/**
 * Moves a task between My Tasks sections, at once on screen.
 *
 * Placement is personal and cheap to get wrong, so the list moves first and
 * the server confirms; a failure puts the task back where it was.
 */
export function usePlaceMyTask(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: ({ taskId, bucket }: { taskId: string; bucket: MyTasksBucket }) =>
      apiClient.put<MyTaskPlacement>(ApiRoutes.myTaskPlacement(workspaceId as string, taskId), {
        bucket,
      }),
    onMutate: async ({ taskId, bucket }) => {
      const cacheKey = key(workspaceId ?? '');
      await queryClient.cancelQueries({ queryKey: cacheKey });
      const previous = queryClient.getQueryData<MyTaskPlacement[]>(cacheKey);
      const rest = (previous ?? []).filter((entry) => entry.taskId !== taskId);
      // Stamped now: a move made today outranks the auto-sort rules.
      queryClient.setQueryData<MyTaskPlacement[]>(cacheKey, [
        ...rest,
        { taskId, bucket, placedAt: new Date().toISOString() },
      ]);
      return { previous };
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key(workspaceId ?? ''), context.previous);
      toast.error(error instanceof ApiError ? error.message : 'Could not move the task.');
    },
  });
}

const rulesKey = (workspaceId: string) => ['my-tasks-rules', workspaceId] as const;

/** The caller's My Tasks auto-sort rules; the defaults until they arrive. */
export function useMyTasksRules(workspaceId: string | undefined) {
  return useQuery({
    queryKey: rulesKey(workspaceId ?? ''),
    queryFn: () => apiClient.get<MyTasksRules>(ApiRoutes.myTasksRules(workspaceId as string)),
    enabled: Boolean(workspaceId),
    placeholderData: DEFAULT_MY_TASKS_RULES,
  });
}

export function useSetMyTasksRules(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (changes: Partial<MyTasksRules>) =>
      apiClient.put<MyTasksRules>(ApiRoutes.myTasksRules(workspaceId as string), changes),
    onSuccess: (rules) => queryClient.setQueryData(rulesKey(workspaceId ?? ''), rules),
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not change the rule.'),
  });
}
