import {
  PROJECT_STATUS_LABEL,
  ProjectApp,
  WebhookEventType,
  type ProjectStatusValue,
} from '@coretask/contracts';
import type { WebhookEventPayload } from '@coretask/types';

import { htmlToText } from '../../../common/utils/rich-text.util';

/** What the payload alone does not say: names, and where the app lives. */
export interface AppMessageContext {
  projectName: string | null;
  /** The section a moved task went to. */
  sectionName: string | null;
  webUrl: string;
}

/** One update, before any tool's formatting: "<actor> <action> <title><tail>". */
interface Update {
  actor: string | null;
  action: string;
  title: string | null;
  url: string | null;
  tail: string;
  quote: string | null;
  footer: string;
}

interface TaskSnapshot {
  id: string;
  title: string;
  projectId: string | null;
  dueDate: string | null;
  assignee: { name: string } | null;
}

const QUOTE_MAX = 300;

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function day(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Reads the event the way a person would say it. */
export function describeUpdate(payload: WebhookEventPayload, context: AppMessageContext): Update {
  const footer = context.projectName ? `${context.projectName} · CoreTask` : 'CoreTask';
  const data = payload.data as {
    task?: TaskSnapshot | null;
    comment?: { body?: string } | null;
    message?: string;
  };

  if (payload.type === WebhookEventType.PING) {
    return {
      actor: null,
      action: data.message ?? 'CoreTask is connected.',
      title: null,
      url: null,
      tail: '',
      quote: null,
      footer,
    };
  }

  if (payload.type === WebhookEventType.PROJECT_STATUS_UPDATED) {
    const status = (
      payload.data as {
        statusUpdate?: { status: ProjectStatusValue; title: string; summary: string | null };
      }
    ).statusUpdate;
    return {
      actor: payload.actor?.name ?? 'Someone',
      action: 'posted a status update:',
      title: status
        ? `${PROJECT_STATUS_LABEL[status.status] ?? status.status} — ${status.title}`
        : 'a status update',
      url: payload.projectId ? `${context.webUrl}/projects/${payload.projectId}/overview` : null,
      tail: '',
      quote: status?.summary ? shorten(status.summary, QUOTE_MAX) : null,
      footer,
    };
  }

  const task = data.task ?? null;
  const projectId = task?.projectId ?? payload.projectId;
  const update: Update = {
    actor: payload.actor?.name ?? (payload.causedByRuleId ? 'A rule' : 'Someone'),
    action: payload.type,
    title: task ? task.title : 'a task that has since been deleted',
    url: task && projectId ? `${context.webUrl}/projects/${projectId}/list?task=${task.id}` : null,
    tail: '',
    quote: null,
    footer,
  };

  switch (payload.type) {
    case WebhookEventType.TASK_CREATED:
      update.action = 'added';
      break;
    case WebhookEventType.TASK_COMPLETED:
      update.action = 'completed';
      break;
    case WebhookEventType.TASK_ASSIGNED:
      if (task?.assignee) {
        update.action = 'assigned';
        update.tail = ` to ${task.assignee.name}`;
      } else {
        update.action = 'unassigned';
      }
      break;
    case WebhookEventType.TASK_MOVED:
      update.action = 'moved';
      update.tail = context.sectionName ? ` to ${context.sectionName}` : '';
      break;
    case WebhookEventType.TASK_DUE_DATE_CHANGED:
      if (task?.dueDate) {
        update.action = 'set the due date of';
        update.tail = ` to ${day(task.dueDate)}`;
      } else {
        update.action = 'removed the due date of';
      }
      break;
    case WebhookEventType.COMMENT_CREATED: {
      update.action = 'commented on';
      const words = htmlToText(data.comment?.body ?? '');
      update.quote = words ? shorten(words, QUOTE_MAX) : null;
      break;
    }
    default:
      update.action = `${payload.type.replace(/[._]/g, ' ')} on`;
  }
  return update;
}

/** The body a tool's incoming webhook takes. */
export function renderAppMessage(
  app: ProjectApp,
  payload: WebhookEventPayload,
  context: AppMessageContext,
): Record<string, unknown> {
  const update = describeUpdate(payload, context);
  switch (app) {
    case ProjectApp.SLACK:
      return slack(update);
    case ProjectApp.TEAMS:
      return teams(update);
    case ProjectApp.GOOGLE_CHAT:
      return googleChat(update);
    case ProjectApp.DISCORD:
      return discord(update);
  }
}

/** The plain sentence, for notifications and anything that shows no markup. */
function plain(update: Update): string {
  const lead = update.actor ? `${update.actor} ${update.action}` : update.action;
  return update.title ? `${lead} “${update.title}”${update.tail}` : lead;
}

// Slack: mrkdwn, where only &, < and > need escaping — and escaping < is
// also what stops a title from writing <!channel>.
const slackText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function slack(update: Update): Record<string, unknown> {
  const title = update.title ? slackText(update.title).replace(/\|/g, '¦') : null;
  const link = title ? (update.url ? `<${update.url}|${title}>` : `*${title}*`) : '';
  const lead = update.actor
    ? `*${slackText(update.actor)}* ${slackText(update.action)}`
    : slackText(update.action);
  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `${lead}${link ? ` ${link}` : ''}${slackText(update.tail)}` },
    },
  ];
  if (update.quote) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `>${slackText(update.quote)}` } });
  }
  blocks.push({
    type: 'context',
    elements: [{ type: 'mrkdwn', text: slackText(update.footer) }],
  });
  return { text: plain(update), blocks };
}

// Teams: an Adaptive Card, as a Workflows webhook expects it.
const teamsText = (text: string) => text.replace(/[[\]*_]/g, (char) => `\\${char}`);

function teams(update: Update): Record<string, unknown> {
  const title = update.title ? teamsText(update.title) : null;
  const link = title ? (update.url ? `[${title}](${update.url})` : `**${title}**`) : '';
  const lead = update.actor
    ? `**${teamsText(update.actor)}** ${teamsText(update.action)}`
    : teamsText(update.action);
  const body: Record<string, unknown>[] = [
    {
      type: 'TextBlock',
      wrap: true,
      text: `${lead}${link ? ` ${link}` : ''}${teamsText(update.tail)}`,
    },
  ];
  if (update.quote) {
    body.push({ type: 'TextBlock', wrap: true, isSubtle: true, text: teamsText(update.quote) });
  }
  body.push({
    type: 'TextBlock',
    wrap: true,
    isSubtle: true,
    size: 'Small',
    text: teamsText(update.footer),
  });
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
          ...(update.url
            ? { actions: [{ type: 'Action.OpenUrl', title: 'Open in CoreTask', url: update.url }] }
            : {}),
        },
      },
    ],
  };
}

// Google Chat: its own light markup; angle brackets would open a link or a
// mention, so people's words get look-alikes instead.
const chatText = (text: string) => text.replace(/</g, '‹').replace(/>/g, '›');

function googleChat(update: Update): Record<string, unknown> {
  const title = update.title ? chatText(update.title).replace(/\|/g, '¦') : null;
  const link = title ? (update.url ? `<${update.url}|${title}>` : `*${title}*`) : '';
  const lead = update.actor
    ? `*${chatText(update.actor)}* ${chatText(update.action)}`
    : chatText(update.action);
  const lines = [`${lead}${link ? ` ${link}` : ''}${chatText(update.tail)}`];
  if (update.quote) lines.push(`_${chatText(update.quote)}_`);
  lines.push(chatText(update.footer));
  return { text: lines.join('\n') };
}

// Discord: markdown, mentions switched off outright.
const discordText = (text: string) => text.replace(/[\\*_~`|[\]>#@-]/g, (char) => `\\${char}`);

function discord(update: Update): Record<string, unknown> {
  const title = update.title ? discordText(update.title) : null;
  const link = title ? (update.url ? `[${title}](<${update.url}>)` : `**${title}**`) : '';
  const lead = update.actor
    ? `**${discordText(update.actor)}** ${discordText(update.action)}`
    : discordText(update.action);
  const lines = [`${lead}${link ? ` ${link}` : ''}${discordText(update.tail)}`];
  if (update.quote) lines.push(`> ${discordText(update.quote)}`);
  lines.push(`-# ${discordText(update.footer)}`);
  return { content: lines.join('\n').slice(0, 2000), allowed_mentions: { parse: [] } };
}
