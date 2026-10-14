import { ApiRoutes } from '@coretask/contracts';
import type { TaskDetail } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** The panel takes the answer as is; lists and boards learn it was completed. */
function settle(workspaceId: string, task: TaskDetail) {
  queryClient.setQueryData(queryKeys.tasks.detail(workspaceId, task.id), task);
  void queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(workspaceId) });
  void queryClient.invalidateQueries({ queryKey: ['work-items', workspaceId] });
}

/** "Mark as duplicate": completes the task and points it at the one it repeats. */
export function useMarkDuplicate(workspaceId: string | undefined, taskId: string) {
  return useMutation({
    mutationFn: (originalId: string) =>
      apiClient.post<TaskDetail>(ApiRoutes.tasks.duplicateOf(workspaceId as string, taskId), {
        taskId: originalId,
      }),
    onSuccess: (task) => {
      settle(workspaceId as string, task);
      toast.success(`Marked as a duplicate of “${task.duplicateOf?.title ?? 'another task'}”.`);
    },
    onError: (error) => report(error, 'Could not mark the task as a duplicate.'),
  });
}

export function useClearDuplicate(workspaceId: string | undefined, taskId: string) {
  return useMutation({
    mutationFn: () =>
      apiClient.delete<TaskDetail>(ApiRoutes.tasks.duplicateOf(workspaceId as string, taskId)),
    onSuccess: (task) => settle(workspaceId as string, task),
    onError: (error) => report(error, 'Could not undo the duplicate.'),
  });
}
