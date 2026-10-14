import { NotificationType } from './enums.js';

/**
 * Which inbox notifications also arrive by email — Asana's Settings ›
 * Notifications. Each person chooses per workspace, by kind rather than by
 * every notification type, so the choice reads the way people think of it.
 */
export const NotificationEmailGroup = {
  ASSIGNED: 'ASSIGNED',
  MENTIONED: 'MENTIONED',
  COMMENTS: 'COMMENTS',
  TASK_CHANGES: 'TASK_CHANGES',
  PROJECT_UPDATES: 'PROJECT_UPDATES',
  DUE_SOON: 'DUE_SOON',
} as const;
export type NotificationEmailGroup =
  (typeof NotificationEmailGroup)[keyof typeof NotificationEmailGroup];
export const NOTIFICATION_EMAIL_GROUPS = Object.values(NotificationEmailGroup);

export const NOTIFICATION_EMAIL_GROUP_LABEL: Record<NotificationEmailGroup, string> = {
  ASSIGNED: 'A task or ticket is assigned to me',
  MENTIONED: 'Someone @mentions me',
  COMMENTS: 'Someone comments on something I follow',
  TASK_CHANGES: 'Something I follow is completed or changes',
  PROJECT_UPDATES: 'A project I’m on posts an update or a message, or adds me',
  DUE_SOON: 'Something of mine is due soon',
};

/** What a person gets before they choose: the two things that are theirs to act on. */
export const DEFAULT_NOTIFICATION_EMAILS: readonly NotificationEmailGroup[] = [
  NotificationEmailGroup.ASSIGNED,
  NotificationEmailGroup.MENTIONED,
];

const GROUP_OF: Partial<Record<NotificationType, NotificationEmailGroup>> = {
  TASK_ASSIGNED: NotificationEmailGroup.ASSIGNED,
  TICKET_ASSIGNED: NotificationEmailGroup.ASSIGNED,
  MENTIONED: NotificationEmailGroup.MENTIONED,
  COMMENT_CREATED: NotificationEmailGroup.COMMENTS,
  TASK_STATUS_CHANGED: NotificationEmailGroup.TASK_CHANGES,
  TICKET_STATUS_CHANGED: NotificationEmailGroup.TASK_CHANGES,
  TASK_UPDATED: NotificationEmailGroup.TASK_CHANGES,
  TICKET_UPDATED: NotificationEmailGroup.TASK_CHANGES,
  FIELD_CHANGED: NotificationEmailGroup.TASK_CHANGES,
  PROJECT_UPDATE: NotificationEmailGroup.PROJECT_UPDATES,
  PROJECT_MEMBER_ADDED: NotificationEmailGroup.PROJECT_UPDATES,
  TASK_DUE_SOON: NotificationEmailGroup.DUE_SOON,
};

/** The group a notification type emails under; null for one with its own email (invites). */
export function emailGroupOf(type: string): NotificationEmailGroup | null {
  return GROUP_OF[type as NotificationType] ?? null;
}

/** Stored groups as they may be trusted: known ones only, each once. */
export function readEmailGroups(value: unknown): NotificationEmailGroup[] {
  if (!Array.isArray(value)) return [...DEFAULT_NOTIFICATION_EMAILS];
  return NOTIFICATION_EMAIL_GROUPS.filter((group) => value.includes(group));
}
