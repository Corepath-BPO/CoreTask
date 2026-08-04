import type { ActivityAction, ActivityEntity, NotificationType } from '@coretask/contracts';

import type { UserRef } from './work-items.js';

/** One line of the append-only audit trail, as the activity feed renders it. */
export interface ActivityEntry {
  id: string;
  workspaceId: string;
  action: ActivityAction;
  entity: ActivityEntity;
  entityId: string;
  summary: string;
  /** Null for system-generated activity: jobs, automations, scheduled work. */
  actor: UserRef | null;
  createdAt: string;
}

export interface NotificationEntry {
  id: string;
  userId: string;
  workspaceId: string | null;
  type: NotificationType;
  title: string;
  body: string | null;
  entity: ActivityEntity | null;
  entityId: string | null;
  /** In-app path to the thing the notification is about. */
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationFeed {
  items: NotificationEntry[];
  /** Counts the whole workspace, not the returned page — it drives the badge. */
  unreadCount: number;
  /**
   * Pass back as `cursor` for the next page; null when there is nothing more.
   *
   * A cursor rather than a page number because the inbox grows at the top: with
   * offsets, one notification arriving between requests shifts everything down
   * and the reader sees an entry twice.
   */
  nextCursor: string | null;
}
