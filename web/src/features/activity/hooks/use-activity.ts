import { ACTIVITY_FEED_LIMIT, NOTIFICATION_FEED_LIMIT } from '@coretask/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { activityApi, notificationsApi } from '../api/activity.api';

export function useActivityFeed(workspaceId: string | undefined, limit = ACTIVITY_FEED_LIMIT) {
  return useQuery({
    queryKey: [...queryKeys.activity.all(workspaceId ?? ''), limit],
    queryFn: () => activityApi.list(workspaceId as string, limit),
    enabled: Boolean(workspaceId),
  });
}

export function useNotifications(workspaceId: string | undefined, limit = NOTIFICATION_FEED_LIMIT) {
  return useQuery({
    queryKey: [...queryKeys.notifications.all(workspaceId ?? ''), limit],
    queryFn: () => notificationsApi.list(workspaceId as string, limit),
    enabled: Boolean(workspaceId),
  });
}

export function useMarkNotificationsRead(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (notificationIds?: string[]) =>
      notificationsApi.markRead(workspaceId as string, notificationIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.notifications.all(workspaceId as string),
      });
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError ? error.message : 'Could not update your notifications.',
      ),
  });
}
