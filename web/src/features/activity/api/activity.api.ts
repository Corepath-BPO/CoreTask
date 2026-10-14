import { ApiRoutes } from '@coretask/contracts';
import type { NotificationType } from '@coretask/contracts';
import type {
  ActivityEntry,
  ItemActivityPage,
  NotificationFeed,
  NotificationView,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

/** One item's stories: which item, and where the previous page ended. */
export interface ItemActivityQuery {
  entity: 'TASK' | 'TICKET';
  entityId: string;
  before?: string;
  limit?: number;
}

export const activityApi = {
  list: (workspaceId: string, limit?: number): Promise<ActivityEntry[]> =>
    apiClient.get<ActivityEntry[]>(ApiRoutes.activity.list(workspaceId), {
      params: limit ? { limit } : undefined,
    }),

  forProject: (
    workspaceId: string,
    query: { projectId: string; before?: string },
  ): Promise<ItemActivityPage> =>
    apiClient.get<ItemActivityPage>(ApiRoutes.activity.forProject(workspaceId), {
      params: { projectId: query.projectId, ...(query.before ? { before: query.before } : {}) },
    }),

  forItem: (workspaceId: string, query: ItemActivityQuery): Promise<ItemActivityPage> =>
    apiClient.get<ItemActivityPage>(ApiRoutes.activity.forItem(workspaceId), {
      params: {
        entity: query.entity,
        entityId: query.entityId,
        ...(query.before ? { before: query.before } : {}),
        ...(query.limit ? { limit: query.limit } : {}),
      },
    }),
};

/** Filters and paging for one page of the inbox. */
export interface NotificationQuery {
  limit?: number;
  unreadOnly?: boolean;
  types?: NotificationType[];
  cursor?: string;
  view?: NotificationView;
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
        // `inbox` is the server's default; sent only for the other piles.
        ...(query.view && query.view !== 'inbox' ? { view: query.view } : {}),
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

  /** Omitting `notificationIds` archives the whole inbox. */
  archive: (
    workspaceId: string,
    notificationIds?: string[],
  ): Promise<{ updated: number; unreadCount: number }> =>
    apiClient.post<{ updated: number; unreadCount: number }>(
      ApiRoutes.notifications.archive(workspaceId),
      notificationIds ? { notificationIds } : {},
    ),

  unarchive: (workspaceId: string, notificationId: string) =>
    apiClient.post<{ updated: number; unreadCount: number }>(
      ApiRoutes.notifications.unarchive(workspaceId, notificationId),
      {},
    ),

  setBookmark: (workspaceId: string, notificationId: string, bookmarked: boolean) =>
    bookmarked
      ? apiClient.post<{ updated: number; unreadCount: number }>(
          ApiRoutes.notifications.bookmark(workspaceId, notificationId),
          {},
        )
      : apiClient.delete<{ updated: number; unreadCount: number }>(
          ApiRoutes.notifications.bookmark(workspaceId, notificationId),
        ),
};
