import type { NotificationEmailGroup } from '@coretask/contracts';

/** Which notifications the caller also gets by email in a workspace, and where they go. */
export interface NotificationPreferences {
  emailGroups: NotificationEmailGroup[];
  /** The address they are sent to: the account's own. */
  emailAddress: string;
}

export interface UpdateNotificationPreferencesPayload {
  emailGroups: NotificationEmailGroup[];
}
