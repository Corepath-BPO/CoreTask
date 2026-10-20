/**
 * The CoreTask Slack app — two ways at once.
 *
 * Into Slack: a project's updates, posted by the app's bot to a channel, with
 * buttons that act on the task. Out of Slack: `/coretask`, a message shortcut
 * and those buttons, done in CoreTask as the person who pressed them. That
 * last part needs to know who they are, so each person links their Slack
 * account once; nothing is done from Slack on behalf of someone unlinked.
 */

/** What the bot may do. Kept short: each one is a line on Slack's consent screen. */
export const SLACK_BOT_SCOPES = [
  // The slash command and the shortcuts.
  'commands',
  // Posting a project's updates, and changing them when a button is pressed.
  'chat:write',
  // Into a public channel without inviting the bot first.
  'chat:write.public',
  // The channel picker in Customize › Apps.
  'channels:read',
  'groups:read',
] as const;

export const SLACK_COMMAND = '/coretask';

/** `callback_id`s the app manifest declares and the interactions endpoint answers. */
export const SlackCallback = {
  /** The global shortcut, and the modal every way in opens. */
  CREATE_TASK: 'coretask_create_task',
  /** The message shortcut: a task from that message. */
  CREATE_FROM_MESSAGE: 'coretask_create_from_message',
} as const;

/** `action_id`s on the buttons and menus CoreTask puts in Slack. */
export const SlackAction = {
  COMPLETE: 'coretask_task_complete',
  ASSIGN_TO_ME: 'coretask_task_assign_me',
  OPEN: 'coretask_task_open',
  LINK: 'coretask_link_account',
  PROJECT: 'coretask_project',
  ASSIGNEE: 'coretask_assignee',
  TITLE: 'coretask_title',
  DESCRIPTION: 'coretask_description',
  DUE_DATE: 'coretask_due_date',
} as const;
export type SlackAction = (typeof SlackAction)[keyof typeof SlackAction];

/** How long an "Add to Slack" click stays good for, and an account-link button. */
export const SLACK_INSTALL_STATE_TTL_SECONDS = 10 * 60;
export const SLACK_LINK_TTL_SECONDS = 30 * 60;

/** Slack's own advice: refuse a request signed more than five minutes ago. */
export const SLACK_REQUEST_TOLERANCE_SECONDS = 5 * 60;

/** A channel's address in a webhook endpoint's `url` when the bot posts there. */
export const SLACK_CHANNEL_URL_PREFIX = 'slack://channel/';

export function slackChannelUrl(channelId: string): string {
  return `${SLACK_CHANNEL_URL_PREFIX}${channelId}`;
}

/** Slack ids: an uppercase letter and then letters and digits. */
export function isSlackId(value: unknown, prefixes = 'CDGTUWB'): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 32 &&
    new RegExp(`^[${prefixes}][A-Z0-9]{2,}$`).test(value)
  );
}
