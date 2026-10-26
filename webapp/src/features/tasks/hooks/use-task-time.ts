import { ApiRoutes } from '@coretask/contracts';
import type { LogTimePayload, TaskTime } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A task's logged time: its entries and their total, beside the estimate. */
export function useTaskTime(workspaceId: string | undefined, taskId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.time(workspaceId ?? '', taskId),
    queryFn: () =>
      apiClient.get<TaskTime>(ApiRoutes.tasks.timeEntries(workspaceId as string, taskId)),
    enabled: Boolean(workspaceId && taskId),
  });
}

/** Every write answers with the task's time as it now is. */
const store = (workspaceId: string, taskId: string) => (time: TaskTime) =>
  queryClient.setQueryData(queryKeys.tasks.time(workspaceId, taskId), time);

export function useLogTime(workspaceId: string | undefined, taskId: string) {
  return useMutation({
    mutationFn: (payload: LogTimePayload) =>
      apiClient.post<TaskTime>(ApiRoutes.tasks.timeEntries(workspaceId as string, taskId), payload),
    onSuccess: store(workspaceId as string, taskId),
    onError: (error) => report(error, 'Could not log the time.'),
  });
}

export function useDeleteTimeEntry(workspaceId: string | undefined, taskId: string) {
  return useMutation({
    mutationFn: (entryId: string) =>
      apiClient.delete<TaskTime>(ApiRoutes.tasks.timeEntry(workspaceId as string, taskId, entryId)),
    onSuccess: store(workspaceId as string, taskId),
    onError: (error) => report(error, 'Could not remove the entry.'),
  });
}
