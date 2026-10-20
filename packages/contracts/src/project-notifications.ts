/**
 * What a project tells its members about — Asana's per-project notification
 * settings. Each member chooses for each project they are on; people who can
 * see a project without being on it hear nothing from it, as in Asana.
 *
 * Every kind arrives as a `PROJECT_UPDATE` notification, so the email setting
 * for project updates decides which of them also come by email.
 */
export const ProjectNotificationKind = {
  STATUS_UPDATES: 'STATUS_UPDATES',
  MESSAGES: 'MESSAGES',
  TASKS_ADDED: 'TASKS_ADDED',
  TASKS_COMPLETED: 'TASKS_COMPLETED',
} as const;
export type ProjectNotificationKind =
  (typeof ProjectNotificationKind)[keyof typeof ProjectNotificationKind];
export const PROJECT_NOTIFICATION_KINDS = Object.values(ProjectNotificationKind);

export const PROJECT_NOTIFICATION_LABEL: Record<ProjectNotificationKind, string> = {
  STATUS_UPDATES: 'Status updates',
  MESSAGES: 'Messages',
  TASKS_ADDED: 'Tasks added',
  TASKS_COMPLETED: 'Tasks completed',
};

export const PROJECT_NOTIFICATION_HINT: Record<ProjectNotificationKind, string> = {
  STATUS_UPDATES: 'Someone posts the project’s status.',
  MESSAGES: 'Someone posts a message to the project’s members.',
  TASKS_ADDED: 'A task or ticket is created in the project, or added to it.',
  TASKS_COMPLETED: 'A task or ticket in the project is completed.',
};

/**
 * What a member hears before choosing: the project speaking to its members.
 * The busy kinds — every task added, every task finished — wait to be asked for.
 */
export const DEFAULT_PROJECT_NOTIFICATIONS: readonly ProjectNotificationKind[] = [
  ProjectNotificationKind.STATUS_UPDATES,
  ProjectNotificationKind.MESSAGES,
];

/** Stored kinds as they may be trusted: known ones only, each once, in a stable order. */
export function readProjectNotifications(value: unknown): ProjectNotificationKind[] {
  if (!Array.isArray(value)) return [...DEFAULT_PROJECT_NOTIFICATIONS];
  return PROJECT_NOTIFICATION_KINDS.filter((kind) => value.includes(kind));
}
