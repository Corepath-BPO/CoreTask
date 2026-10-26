import { ApiRoutes } from '@coretask/contracts';
import type { GoalUpdate, PostGoalUpdatePayload } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient } from '@/lib/api/query-client';

const routes = ApiRoutes.goals;

/** Under the goals prefix, so the list's refresh after any goal write reaches it too. */
const key = (workspaceId: string, goalId: string) =>
  ['goals', workspaceId, 'updates', goalId] as const;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A goal's status updates, newest first. */
export function useGoalUpdates(workspaceId: string | undefined, goalId: string) {
  return useQuery({
    queryKey: key(workspaceId ?? '', goalId),
    queryFn: () => apiClient.get<GoalUpdate[]>(routes.updates(workspaceId as string, goalId)),
    enabled: Boolean(workspaceId && goalId),
  });
}

/** A new update sets the goal's status too, so the whole goal list refreshes. */
const refresh = (workspaceId: string) =>
  queryClient.invalidateQueries({ queryKey: ['goals', workspaceId] });

export function usePostGoalUpdate(workspaceId: string | undefined, goalId: string) {
  return useMutation({
    mutationFn: (payload: PostGoalUpdatePayload) =>
      apiClient.post<GoalUpdate>(routes.updates(workspaceId as string, goalId), payload),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not post the update.'),
  });
}

export function useDeleteGoalUpdate(workspaceId: string | undefined, goalId: string) {
  return useMutation({
    mutationFn: (updateId: string) =>
      apiClient.delete<void>(routes.update(workspaceId as string, goalId, updateId)),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not delete the update.'),
  });
}
