import { ApiRoutes } from '@coretask/contracts';
import type { CalendarFeed } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

/** The caller's calendar link for My Tasks (`projectId` null) or a project; null until made. */
export function useCalendarFeed(workspaceId: string | undefined, projectId: string | null) {
  return useQuery({
    queryKey: queryKeys.calendarFeed(workspaceId ?? '', projectId),
    queryFn: () =>
      apiClient.get<CalendarFeed | null>(ApiRoutes.calendarFeeds.mine(workspaceId as string), {
        params: projectId ? { projectId } : undefined,
      }),
    enabled: Boolean(workspaceId),
  });
}

function onError(fallback: string) {
  return (error: unknown) => toast.error(error instanceof ApiError ? error.message : fallback);
}

export function useCreateCalendarFeed(workspaceId: string, projectId: string | null) {
  return useMutation({
    mutationFn: () =>
      apiClient.post<CalendarFeed>(ApiRoutes.calendarFeeds.mine(workspaceId), { projectId }),
    onSuccess: (feed) =>
      queryClient.setQueryData(queryKeys.calendarFeed(workspaceId, projectId), feed),
    onError: onError('Could not make a calendar link.'),
  });
}

/** A new link; the old one stops working, so every subscription to it ends. */
export function useResetCalendarFeed(workspaceId: string, projectId: string | null) {
  return useMutation({
    mutationFn: () =>
      apiClient.post<CalendarFeed>(ApiRoutes.calendarFeeds.reset(workspaceId), { projectId }),
    onSuccess: (feed) => {
      queryClient.setQueryData(queryKeys.calendarFeed(workspaceId, projectId), feed);
      toast.success('New link made. The old one no longer works.');
    },
    onError: onError('Could not reset the link.'),
  });
}

export function useStopCalendarFeed(workspaceId: string, projectId: string | null) {
  return useMutation({
    mutationFn: () =>
      apiClient.delete<void>(ApiRoutes.calendarFeeds.mine(workspaceId), {
        params: projectId ? { projectId } : undefined,
      }),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.calendarFeed(workspaceId, projectId), null);
      toast.success('Calendar sync stopped.');
    },
    onError: onError('Could not stop syncing.'),
  });
}
