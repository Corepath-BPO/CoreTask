import {
  ACTIVITY_FEED_LIMIT,
  NOTIFICATION_FEED_LIMIT,
  NotificationType,
} from '@coretask/contracts';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
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
    queryFn: () => notificationsApi.list(workspaceId as string, { limit }),
    enabled: Boolean(workspaceId),
  });
}

/**
 * The inbox page's feed: filtered, and paged with "load more".
 *
 * `useInfiniteQuery` rather than accumulating pages by hand so that marking
 * something read refetches every page already on screen — with manual
 * accumulation the earlier pages would keep showing stale read state.
 *
 * The key holds only the filter, never a cursor or a timestamp. A value that
 * changes on every render puts the query in a refetch loop, which is what caused
 * the 429 storm on the dashboard.
 */
export function useInbox(workspaceId: string | undefined, filter: InboxFilter) {
  return useInfiniteQuery({
    queryKey: [...queryKeys.notifications.all(workspaceId ?? ''), 'inbox', filter],
    queryFn: ({ pageParam }) =>
      notificationsApi.list(workspaceId as string, {
        limit: INBOX_PAGE_SIZE,
        ...(filter === 'unread' ? { unreadOnly: true } : {}),
        ...(filter === 'mentions' ? { types: [NotificationType.MENTIONED] } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId),
  });
}

export function useMarkNotificationUnread(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (notificationId: string) =>
      notificationsApi.markUnread(workspaceId as string, notificationId),
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

/** Which slice of the inbox is on screen. */
export type InboxFilter = 'all' | 'unread' | 'mentions';

/** Big enough that most inboxes need no second page, small enough to stay fast. */
const INBOX_PAGE_SIZE = 25;
