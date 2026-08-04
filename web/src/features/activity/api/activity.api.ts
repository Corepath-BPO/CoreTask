import { ApiRoutes } from '@coretask/contracts';
import type { NotificationType } from '@coretask/contracts';
import type { ActivityEntry, NotificationFeed } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const activityApi = {
  list: (workspaceId: string, limit?: number): Promise<ActivityEntry[]> =>
    apiClient.get<ActivityEntry[]>(ApiRoutes.activity.list(workspaceId), {
      params: limit ? { limit } : undefined,
    }),
};

/** Filters and paging for one page of the inbox. */
export interface NotificationQuery {
  limit?: number;
  unreadOnly?: boolean;
  types?: NotificationType[];
  cursor?: string;
}

export const notificationsApi = {
  list: (workspaceId: string, query: NotificationQuery = {}): Promise<NotificationFeed> =>
    apiClient.get<NotificationFeed>(ApiRoutes.notifications.list(workspaceId), {
      params: {
        ...(query.limit ? { limit: query.limit } : {}),
        // Sent only when narrowing. `unreadOnly=false` means the same thing as
        // omitting it, and leaving it out keeps the query key — and the cache
        // entry — the same for both.
        ...(query.unreadOnly ? { unreadOnly: true } : {}),
        ...(query.types?.length ? { types: query.types } : {}),
        ...(query.cursor ? { cursor: query.cursor } : {}),
      },
    }),

  markUnread: (
    workspaceId: string,
    notificationId: string,
  ): Promise<{ updated: number; unreadCount: number }> =>
    apiClient.post<{ updated: number; unreadCount: number }>(
      ApiRoutes.notifications.markUnread(workspaceId, notificationId),
      {},
    ),

  /** Omitting `notificationIds` clears the whole workspace inbox. */
  markRead: (
    workspaceId: string,
    notificationIds?: string[],
  ): Promise<{ updated: number; unreadCount: number }> =>
    apiClient.post<{ updated: number; unreadCount: number }>(
      ApiRoutes.notifications.markRead(workspaceId),
      notificationIds ? { notificationIds } : {},
    ),
};
