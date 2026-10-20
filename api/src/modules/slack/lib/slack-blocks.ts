import { SLACK_COMMAND, SlackAction, SlackCallback } from '@coretask/contracts';

/**
 * The Block Kit CoreTask sends: the create-task modal, the buttons on a
 * channel post, and the few short replies. Kept apart from the services so a
 * unit test can read what Slack will be shown.
 */

type Block = Record<string, unknown>;

/** mrkdwn needs only &, < and > escaped — and escaping < is what stops `<!channel>`. */
export function mrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A link whose label cannot close it early. */
export function mrkdwnLink(url: string, label: string): string {
  return `<${url}|${mrkdwn(label).replace(/\|/g, '¦')}>`;
}

const plain = (text: string, max = 75) => ({
  type: 'plain_text',
  text: text.length > max ? `${text.slice(0, max - 1)}…` : text,
  emoji: true,
});

/**
 * A Slack message as words: mentions, channels and links back to what a
 * person would have read, and the three escapes undone. For a task made from
 * a message, whose text Slack sends in its own markup.
 */
export function slackToPlainText(text: string): string {
  return text
    .replace(/<([^<>]+)>/g, (_match, inner: string) => {
      const [target = '', label] = inner.split('|');
      if (target.startsWith('@')) return label ? `@${label.replace(/^@/, '')}` : '@someone';
      if (target.startsWith('#')) return label ? `#${label}` : '#channel';
      if (target.startsWith('!subteam^')) return label ?? '@team';
      if (target.startsWith('!')) return `@${target.slice(1).split('^')[0]}`;
      if (target.startsWith('mailto:')) return label ?? target.slice('mailto:'.length);
      return label && label !== target ? `${label} (${target})` : target;
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** A message's address, built the way Slack's own "Copy link" builds it. */
export function messagePermalink(
  teamDomain: string | undefined,
  channelId: string | undefined,
  ts: string | undefined,
): string | null {
  if (!teamDomain || !channelId || !ts || !/^[a-z0-9-]+$/i.test(teamDomain)) return null;
  return `https://${teamDomain}.slack.com/archives/${channelId}/p${ts.replace('.', '')}`;
}

/** What the modal remembers between opening and submitting. */
export interface CreateTaskMetadata {
  /** Where it was opened from, for the reply. */
  channelId: string | null;
}

export interface CreateTaskModalInput {
  title?: string;
  description?: string;
  metadata: CreateTaskMetadata;
}

export const TaskModalBlock = {
  TITLE: 'title',
  PROJECT: 'project',
  ASSIGNEE: 'assignee',
  DUE_DATE: 'due',
  DESCRIPTION: 'description',
} as const;

/**
 * The one way a task is made from Slack. Project and assignee are searched
 * as you type (`external_select`), so a workspace of any size fits; both are
 * optional, as in CoreTask, where a task without a project is in My Tasks.
 */
export function createTaskModal(input: CreateTaskModalInput): Block {
  return {
    type: 'modal',
    callback_id: SlackCallback.CREATE_TASK,
    private_metadata: JSON.stringify(input.metadata),
    title: plain('New task', 24),
    submit: plain('Create', 24),
    close: plain('Cancel', 24),
    blocks: [
      {
        type: 'input',
        block_id: TaskModalBlock.TITLE,
        label: plain('Task name'),
        element: {
          type: 'plain_text_input',
          action_id: SlackAction.TITLE,
          max_length: 500,
          ...(input.title ? { initial_value: input.title.slice(0, 500) } : {}),
          placeholder: plain('What needs doing?', 150),
        },
      },
      {
        type: 'input',
        block_id: TaskModalBlock.PROJECT,
        optional: true,
        label: plain('Project'),
        hint: plain('Leave it empty and the task stays in your My Tasks.', 150),
        element: {
          type: 'external_select',
          action_id: SlackAction.PROJECT,
          min_query_length: 0,
          placeholder: plain('Choose a project', 150),
        },
      },
      {
        type: 'input',
        block_id: TaskModalBlock.ASSIGNEE,
        optional: true,
        label: plain('Assignee'),
        element: {
          type: 'external_select',
          action_id: SlackAction.ASSIGNEE,
          min_query_length: 0,
          placeholder: plain('Nobody yet', 150),
        },
      },
      {
        type: 'input',
        block_id: TaskModalBlock.DUE_DATE,
        optional: true,
        label: plain('Due date'),
        element: { type: 'datepicker', action_id: SlackAction.DUE_DATE },
      },
      {
        type: 'input',
        block_id: TaskModalBlock.DESCRIPTION,
        optional: true,
        label: plain('Description'),
        element: {
          type: 'plain_text_input',
          action_id: SlackAction.DESCRIPTION,
          multiline: true,
          max_length: 3000,
          ...(input.description ? { initial_value: input.description.slice(0, 3000) } : {}),
        },
      },
    ],
  };
}

/** Replaces the form once the task exists, so the result is where the person is looking. */
export function taskCreatedModal(task: { title: string; url: string; details: string[] }): Block {
  return {
    type: 'modal',
    title: plain('Task created', 24),
    close: plain('Done', 24),
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `:white_check_mark: ${mrkdwnLink(task.url, task.title)}` },
      },
      ...(task.details.length > 0
        ? [
            {
              type: 'context',
              elements: [{ type: 'mrkdwn', text: mrkdwn(task.details.join(' · ')) }],
            },
          ]
        : []),
    ],
  };
}

/** One option for an `external_select`; Slack allows 75 characters of text. */
export function option(label: string, value: string, description?: string): Block {
  return {
    text: plain(label),
    value,
    ...(description ? { description: plain(description) } : {}),
  };
}

/** The block id the task buttons travel in, so a later update can find and replace them. */
const TASK_ACTIONS_PREFIX = 'coretask_task:';
const NOTE_BLOCK_ID = 'coretask_note';

export interface TaskButtons {
  id: string;
  url: string;
  completed: boolean;
  /** An approval is decided in CoreTask, so it gets no "Mark complete". */
  approval?: boolean;
}

/** The buttons under a task's post. Completed tasks keep only the way in. */
export function taskActions(task: TaskButtons): Block {
  const elements: Block[] = [];
  if (!task.completed && !task.approval) {
    elements.push({
      type: 'button',
      action_id: SlackAction.COMPLETE,
      text: plain('Mark complete'),
      style: 'primary',
      value: task.id,
    });
  }
  if (!task.completed) {
    elements.push({
      type: 'button',
      action_id: SlackAction.ASSIGN_TO_ME,
      text: plain('Assign to me'),
      value: task.id,
    });
  }
  elements.push({
    type: 'button',
    action_id: SlackAction.OPEN,
    text: plain('Open in CoreTask'),
    url: task.url,
  });
  return { type: 'actions', block_id: `${TASK_ACTIONS_PREFIX}${task.id}`, elements };
}

/**
 * A post after someone acted on it from Slack: what they did, said under the
 * message, and the buttons redrawn for the task as it is now. The update is
 * otherwise the original's — it was true when it was posted.
 */
export function acknowledgedBlocks(
  original: unknown[],
  note: string,
  task: TaskButtons,
): unknown[] {
  const kept = original.filter((block) => {
    const id = (block as { block_id?: unknown } | null)?.block_id;
    return typeof id !== 'string' || (!id.startsWith(TASK_ACTIONS_PREFIX) && id !== NOTE_BLOCK_ID);
  });
  return [
    ...kept,
    { type: 'context', block_id: NOTE_BLOCK_ID, elements: [{ type: 'mrkdwn', text: note }] },
    taskActions(task),
  ];
}

/**
 * Said, privately, to someone who has not linked their account yet — or who
 * asked for the link. `purpose` finishes "To …," when something sent them
 * here: "make tasks from Slack".
 */
export function linkPrompt(url: string, purpose?: string): { text: string; blocks: Block[] } {
  const lead = purpose
    ? `To ${purpose}, link your CoreTask account first.`
    : 'Link your CoreTask account.';
  return {
    text: `${lead} ${url}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${mrkdwn(lead)} It takes a moment, once: what you do here is then done as you, with your access.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            action_id: SlackAction.LINK,
            text: plain('Link your account'),
            style: 'primary',
            url,
          },
        ],
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: 'The link works for 30 minutes, and only for you.' }],
      },
    ],
  };
}

export function helpMessage(): { text: string } {
  return {
    text: [
      '*CoreTask in Slack*',
      `• \`${SLACK_COMMAND} <task name>\` — make a task (a form opens to fill in the rest)`,
      '• On any message, *More actions › Create a CoreTask task* — make a task from it',
      `• \`${SLACK_COMMAND} link\` — link your CoreTask account`,
      `• \`${SLACK_COMMAND} unlink\` — stop acting as yourself from Slack`,
      'Updates a project posts here come with buttons to complete a task or take it.',
    ].join('\n'),
  };
}
