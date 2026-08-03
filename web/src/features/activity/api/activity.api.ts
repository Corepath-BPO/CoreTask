import { ApiRoutes } from '@coretask/contracts';
import type { ActivityEntry, NotificationFeed } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const activityApi = {
  list: (workspaceId: string, limit?: number): Promise<ActivityEntry[]> =>
    apiClient.get<ActivityEntry[]>(ApiRoutes.activity.list(workspaceId), {
      params: limit ? { limit } : undefined,
    }),
};

export const notificationsApi = {
  list: (workspaceId: string, limit?: number): Promise<NotificationFeed> =>
    apiClient.get<NotificationFeed>(ApiRoutes.notifications.list(workspaceId), {
      params: limit ? { limit } : undefined,
    }),

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
