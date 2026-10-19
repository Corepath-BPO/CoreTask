import { WebhookEventType } from './webhooks.js';

/**
 * Apps on a project — Customize › Apps.
 *
 * Each app is a chat tool that takes an incoming webhook: paste the URL the
 * tool gives for a channel, pick what to hear about, and the project's
 * changes are posted there as messages written for that tool. Underneath it
 * is a webhook endpoint scoped to the project, so retries, the delivery log
 * and switching off after repeated failures all come with it.
 */

export const ProjectApp = {
  SLACK: 'SLACK',
  TEAMS: 'TEAMS',
  GOOGLE_CHAT: 'GOOGLE_CHAT',
  DISCORD: 'DISCORD',
} as const;
export type ProjectApp = (typeof ProjectApp)[keyof typeof ProjectApp];
export const PROJECT_APPS = Object.values(ProjectApp);

export interface ProjectAppInfo {
  label: string;
  /** One line for the gallery. */
  blurb: string;
  /** Where the URL comes from, for the connect dialog. */
  howTo: string;
  placeholder: string;
  /** Hostnames the URL may have, exactly or as a parent domain. */
  hosts: readonly string[];
}

export const PROJECT_APP_INFO: Record<ProjectApp, ProjectAppInfo> = {
  SLACK: {
    label: 'Slack',
    blurb: 'Post task and comment updates to a Slack channel.',
    howTo:
      'In Slack, create an app with Incoming Webhooks turned on (or a workflow that starts from a webhook), add it to a channel, and copy the webhook URL.',
    placeholder: 'https://hooks.slack.com/services/…',
    hosts: ['hooks.slack.com'],
  },
  TEAMS: {
    label: 'Microsoft Teams',
    blurb: 'Post updates to a Teams channel as cards.',
    howTo:
      'In the channel, open Workflows and choose “Post to a channel when a webhook request is received”, then copy the URL it gives you.',
    placeholder: 'https://…logic.azure.com/workflows/…',
    hosts: ['logic.azure.com', 'powerplatform.com', 'powerautomate.com', 'webhook.office.com'],
  },
  GOOGLE_CHAT: {
    label: 'Google Chat',
    blurb: 'Post updates to a Google Chat space.',
    howTo: 'In the space, open Apps & integrations, add a webhook, and copy its URL.',
    placeholder: 'https://chat.googleapis.com/v1/spaces/…',
    hosts: ['chat.googleapis.com'],
  },
  DISCORD: {
    label: 'Discord',
    blurb: 'Post updates to a Discord channel.',
    howTo: 'In the channel’s settings, open Integrations › Webhooks, create one, and copy its URL.',
    placeholder: 'https://discord.com/api/webhooks/…',
    hosts: ['discord.com', 'discordapp.com'],
  },
};

/** What an app can be told about: the project's own goings-on. */
export const PROJECT_APP_EVENTS = [
  WebhookEventType.TASK_CREATED,
  WebhookEventType.TASK_COMPLETED,
  WebhookEventType.TASK_ASSIGNED,
  WebhookEventType.TASK_MOVED,
  WebhookEventType.TASK_DUE_DATE_CHANGED,
  WebhookEventType.COMMENT_CREATED,
  WebhookEventType.PROJECT_STATUS_UPDATED,
] as const;
export type ProjectAppEvent = (typeof PROJECT_APP_EVENTS)[number];

export const DEFAULT_PROJECT_APP_EVENTS: readonly ProjectAppEvent[] = [
  WebhookEventType.TASK_CREATED,
  WebhookEventType.TASK_COMPLETED,
  WebhookEventType.COMMENT_CREATED,
  WebhookEventType.PROJECT_STATUS_UPDATED,
];

export const PROJECT_APP_EVENT_LABEL: Record<ProjectAppEvent, string> = {
  'task.created': 'A task is added',
  'task.completed': 'A task is completed',
  'task.assigned': 'A task is assigned',
  'task.moved': 'A task moves section',
  'task.due_date_changed': 'A due date changes',
  'comment.created': 'Someone comments',
  'project.status_updated': 'A status update is posted',
};

export const MAX_APPS_PER_PROJECT = 10;
export const PROJECT_APP_NAME_MAX = 80;

/** Whether `url` is one of the app's own webhook addresses. */
export function appAcceptsUrl(app: ProjectApp, url: string): boolean {
  // No URL global here (this package runs anywhere), and the check is narrow:
  // https, no credentials, a hostname under one of the app's domains.
  const authority = /^https:\/\/([^/?#]*)/i.exec(url.trim())?.[1] ?? '';
  if (!authority || authority.includes('@')) return false;
  const host = authority.replace(/:\d+$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  return PROJECT_APP_INFO[app].hosts.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`),
  );
}
