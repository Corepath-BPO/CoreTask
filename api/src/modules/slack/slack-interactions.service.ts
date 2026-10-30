import {
  SlackAction,
  SlackCallback,
  TASK_TITLE_MAX_LENGTH,
  TaskKind,
  TaskStatus,
  WorkspaceRole,
} from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import type { SlackInstallation } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { SlackApiClient, SlackApiError } from '../../integrations/slack/slack-api.client';
import { ProjectAccessService } from '../project-access/project-access.service';
import { TasksService } from '../tasks/tasks.service';

import {
  acknowledgedBlocks,
  createTaskModal,
  helpMessage,
  linkPrompt,
  messagePermalink,
  mrkdwn,
  option,
  slackToPlainText,
  TaskModalBlock,
  taskCreatedModal,
  type CreateTaskMetadata,
} from './lib/slack-blocks';
import { SlackService } from './slack.service';

/** What Slack posts for `/coretask …`, form-encoded. */
export interface SlashCommand {
  team_id?: string;
  user_id?: string;
  channel_id?: string;
  text?: string;
  trigger_id?: string;
}

/** The parts of an interaction payload this reads; Slack sends a great deal more. */
export interface Interaction {
  type?: string;
  callback_id?: string;
  trigger_id?: string;
  action_id?: string;
  block_id?: string;
  value?: string;
  team?: { id?: string; domain?: string };
  user?: { id?: string };
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string };
  message?: { text?: string; ts?: string; blocks?: unknown[] };
  actions?: { action_id?: string; value?: string }[];
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: { values?: Record<string, Record<string, SlackInputValue>> };
  };
}

interface SlackInputValue {
  value?: string | null;
  selected_option?: { value?: string } | null;
  selected_date?: string | null;
}

/** An immediate reply: the body of the 200 Slack is waiting for. */
export type SlackReply = Record<string, unknown> | null;

/** What a modal's error map can point at; anything else goes on the title. */
const FIELD_OF_ERROR: Record<string, string> = {
  project: TaskModalBlock.PROJECT,
  section: TaskModalBlock.PROJECT,
  assignee: TaskModalBlock.ASSIGNEE,
  due: TaskModalBlock.DUE_DATE,
};

const MAX_OPTIONS = 100;

/**
 * Everything Slack sends: the slash command, shortcuts, modal submissions,
 * button presses, and the searches behind the modal's menus.
 *
 * Work is done in CoreTask's own services as the linked person, so Slack
 * gets exactly the access that person has in the app — a private project
 * they are not in is as invisible here as there. Slack waits three seconds
 * for an answer, and every path here is a database read or two and at most
 * one call back to Slack.
 */
@Injectable()
export class SlackInteractionsService {
  private readonly logger = new Logger(SlackInteractionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly installations: SlackService,
    private readonly slack: SlackApiClient,
    private readonly tasks: TasksService,
    private readonly access: ProjectAccessService,
  ) {}

  // ---- /coretask ------------------------------------------------------------

  async command(body: SlashCommand): Promise<SlackReply> {
    const installation = body.team_id ? await this.installations.findByTeam(body.team_id) : null;
    if (!installation || !body.user_id) return ephemeral(NOT_CONNECTED);

    const text = (body.text ?? '').trim();
    const [verb = '', ...rest] = text.split(/\s+/);
    const word = verb.toLowerCase();

    if (word === '' || word === 'help') return ephemeral(helpMessage().text);

    if (word === 'link') {
      return ephemeral(linkPrompt(this.installations.linkUrl(installation, body.user_id)));
    }

    if (word === 'unlink') {
      const removed = await this.prisma.slackUserLink.deleteMany({
        where: { installationId: installation.id, slackUserId: body.user_id },
      });
      return ephemeral(
        removed.count > 0
          ? 'Done — this Slack account is no longer linked to CoreTask. `/coretask link` links it again.'
          : 'This Slack account was not linked to CoreTask.',
      );
    }

    const actor = await this.actorFor(installation, body.user_id);
    if (!actor) {
      return ephemeral(
        linkPrompt(this.installations.linkUrl(installation, body.user_id), 'make tasks from Slack'),
      );
    }
    if (!body.trigger_id) return ephemeral('Slack did not say where to open the form. Try again.');

    const title = ['create', 'new', 'add', 'task'].includes(word) ? rest.join(' ') : text;
    try {
      await this.slack.openView(
        this.installations.botToken(installation),
        body.trigger_id,
        createTaskModal({ title, metadata: { channelId: body.channel_id ?? null } }),
      );
    } catch (error) {
      this.logger.warn({ err: describe(error) }, 'Could not open the Slack task form');
      return ephemeral('Slack would not open the form just now. Try again in a moment.');
    }
    return null;
  }

  // ---- interactivity --------------------------------------------------------

  async interaction(payload: Interaction): Promise<SlackReply> {
    const installation = payload.team?.id
      ? await this.installations.findByTeam(payload.team.id)
      : null;
    const slackUserId = payload.user?.id;
    if (!installation || !slackUserId) return null;

    switch (payload.type) {
      case 'shortcut':
      case 'message_action':
        await this.openCreateForm(installation, slackUserId, payload);
        return null;
      case 'view_submission':
        return payload.view?.callback_id === SlackCallback.CREATE_TASK
          ? this.submitCreateForm(installation, slackUserId, payload)
          : null;
      case 'block_suggestion':
        return this.suggest(installation, slackUserId, payload);
      case 'block_actions':
        await this.act(installation, slackUserId, payload);
        return null;
      default:
        return null;
    }
  }

  private async openCreateForm(
    installation: SlackInstallation,
    slackUserId: string,
    payload: Interaction,
  ): Promise<void> {
    if (!payload.trigger_id) return;
    const token = this.installations.botToken(installation);
    const actor = await this.actorFor(installation, slackUserId);

    let view: Record<string, unknown>;
    if (!actor) {
      view = noticeModal(
        'Link your account',
        linkPrompt(this.installations.linkUrl(installation, slackUserId), 'make tasks from Slack')
          .blocks,
      );
    } else if (payload.callback_id === SlackCallback.CREATE_FROM_MESSAGE) {
      const words = slackToPlainText(payload.message?.text ?? '').trim();
      const firstLine = words.split('\n').find((line) => line.trim()) ?? '';
      const permalink = messagePermalink(
        payload.team?.domain,
        payload.channel?.id,
        payload.message?.ts,
      );
      view = createTaskModal({
        title: shorten(firstLine.trim(), 120),
        description: [words, permalink ? `From Slack: ${permalink}` : '']
          .filter(Boolean)
          .join('\n\n'),
        metadata: { channelId: payload.channel?.id ?? null },
      });
    } else {
      view = createTaskModal({ metadata: { channelId: null } });
    }

    try {
      await this.slack.openView(token, payload.trigger_id, view);
    } catch (error) {
      this.logger.warn({ err: describe(error) }, 'Could not open a Slack modal');
    }
  }

  private async submitCreateForm(
    installation: SlackInstallation,
    slackUserId: string,
    payload: Interaction,
  ): Promise<SlackReply> {
    const actor = await this.actorFor(installation, slackUserId);
    if (!actor) {
      return formErrors(
        TaskModalBlock.TITLE,
        'Your Slack account is no longer linked to CoreTask. Use /coretask link, then try again.',
      );
    }

    const values = payload.view?.state?.values ?? {};
    const read = (block: string, action: string) => values[block]?.[action];
    const title = (read(TaskModalBlock.TITLE, SlackAction.TITLE)?.value ?? '').trim();
    const projectId = read(TaskModalBlock.PROJECT, SlackAction.PROJECT)?.selected_option?.value;
    const assigneeId = read(TaskModalBlock.ASSIGNEE, SlackAction.ASSIGNEE)?.selected_option?.value;
    const dueDate = read(TaskModalBlock.DUE_DATE, SlackAction.DUE_DATE)?.selected_date;
    const description = (
      read(TaskModalBlock.DESCRIPTION, SlackAction.DESCRIPTION)?.value ?? ''
    ).trim();

    if (!title) return formErrors(TaskModalBlock.TITLE, 'Give the task a name.');
    if (title.length > TASK_TITLE_MAX_LENGTH) {
      return formErrors(TaskModalBlock.TITLE, `Keep it under ${TASK_TITLE_MAX_LENGTH} characters.`);
    }
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return formErrors(TaskModalBlock.DUE_DATE, 'That is not a date Slack should send.');
    }

    const workspaceId = installation.workspaceId;
    let sectionId: string | undefined;
    if (projectId) {
      // The project's first column, where a task added at the top of its
      // board would go — rather than outside every section.
      const section = await this.prisma.section.findFirst({
        where: { projectId, workspaceId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });
      sectionId = section?.id;
    }

    let created;
    try {
      created = await this.tasks.create(workspaceId, actor, {
        title,
        ...(description ? { description } : {}),
        ...(projectId ? { projectId } : {}),
        ...(sectionId ? { sectionId } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(dueDate ? { dueDate: `${dueDate}T00:00:00.000Z` } : {}),
      });
    } catch (error) {
      if (error instanceof AppException) {
        const message = error.message || 'CoreTask could not make that task.';
        const field =
          Object.entries(FIELD_OF_ERROR).find(([word]) =>
            message.toLowerCase().includes(word),
          )?.[1] ?? (projectId ? TaskModalBlock.PROJECT : TaskModalBlock.TITLE);
        return formErrors(field, message);
      }
      throw error;
    }

    const metadata = parseMetadata(payload.view?.private_metadata);
    this.logger.log(
      { workspaceId, taskId: created.id, fromChannel: metadata.channelId },
      'Task created from Slack',
    );

    const project = created.projectId
      ? await this.prisma.project.findUnique({
          where: { id: created.projectId },
          select: { name: true },
        })
      : null;
    const details = [
      project?.name ?? 'My Tasks',
      created.assignee ? `assigned to ${created.assignee.name}` : null,
      created.dueDate ? `due ${formatDay(created.dueDate)}` : null,
    ].filter((part): part is string => Boolean(part));
    return {
      response_action: 'update',
      view: taskCreatedModal({
        title: created.title,
        url: this.taskUrl(created),
        details,
      }),
    };
  }

  /** The searches behind the project and assignee menus. */
  private async suggest(
    installation: SlackInstallation,
    slackUserId: string,
    payload: Interaction,
  ): Promise<SlackReply> {
    const actor = await this.actorFor(installation, slackUserId);
    if (!actor) return { options: [] };
    const query = (payload.value ?? '').trim().slice(0, 100);
    const workspaceId = installation.workspaceId;

    if (payload.action_id === SlackAction.PROJECT) {
      const projects = await this.prisma.project.findMany({
        where: {
          workspaceId,
          archivedAt: null,
          ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
          AND: [this.access.projectWhere(actor)],
        },
        orderBy: [{ updatedAt: 'desc' }],
        take: MAX_OPTIONS,
        select: { id: true, name: true },
      });
      return { options: projects.map((project) => option(project.name, project.id)) };
    }

    if (payload.action_id === SlackAction.ASSIGNEE) {
      const members = await this.prisma.workspaceMember.findMany({
        where: {
          workspaceId,
          deactivatedAt: null,
          user: {
            isServiceAccount: false,
            ...(query
              ? {
                  OR: [
                    { name: { contains: query, mode: 'insensitive' } },
                    { email: { contains: query, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
        },
        orderBy: { user: { name: 'asc' } },
        take: MAX_OPTIONS,
        select: { user: { select: { id: true, name: true, email: true } } },
      });
      // You first: the one most often meant.
      const people = members
        .map((member) => member.user)
        .sort((a, b) => Number(b.id === actor.userId) - Number(a.id === actor.userId));
      return {
        options: people.map((person) =>
          option(person.id === actor.userId ? `${person.name} (you)` : person.name, person.id),
        ),
      };
    }

    return { options: [] };
  }

  /** "Mark complete" and "Assign to me" on a project's post. */
  private async act(
    installation: SlackInstallation,
    slackUserId: string,
    payload: Interaction,
  ): Promise<void> {
    // Menus and buttons inside a modal need no answer of their own.
    if (payload.view) return;
    const action = payload.actions?.[0];
    const taskId = action?.value;
    if (
      !action ||
      !taskId ||
      (action.action_id !== SlackAction.COMPLETE && action.action_id !== SlackAction.ASSIGN_TO_ME)
    ) {
      return;
    }

    const token = this.installations.botToken(installation);
    const actor = await this.actorFor(installation, slackUserId);
    if (!actor) {
      await this.notice(
        token,
        payload,
        'Link your account',
        linkPrompt(this.installations.linkUrl(installation, slackUserId), 'act on tasks from Slack')
          .blocks,
      );
      return;
    }

    const completing = action.action_id === SlackAction.COMPLETE;
    let task;
    try {
      task = await this.tasks.update(
        installation.workspaceId,
        actor,
        taskId,
        completing ? { status: TaskStatus.DONE } : { assigneeId: actor.userId },
      );
    } catch (error) {
      const message =
        error instanceof AppException
          ? error.message
          : 'CoreTask could not change that task just now.';
      if (!(error instanceof AppException)) {
        this.logger.warn({ err: describe(error), taskId }, 'Slack action failed');
      }
      await this.notice(token, payload, 'Nothing changed', [
        { type: 'section', text: { type: 'mrkdwn', text: mrkdwn(message) } },
      ]);
      return;
    }

    const person = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true },
    });
    const name = mrkdwn(person?.name ?? 'Someone');
    const note = completing
      ? `:white_check_mark: Marked complete by *${name}* from Slack`
      : `:raising_hand: *${name}* took this from Slack`;

    const channel = payload.container?.channel_id ?? payload.channel?.id;
    const ts = payload.container?.message_ts ?? payload.message?.ts;
    if (!channel || !ts || !payload.message) return;
    try {
      await this.slack.updateMessage(token, channel, ts, {
        text: payload.message.text ?? task.title,
        blocks: acknowledgedBlocks(payload.message.blocks ?? [], note, {
          id: task.id,
          url: this.taskUrl(task),
          completed: task.completedAt !== null,
          approval: task.kind === TaskKind.APPROVAL,
        }),
      });
    } catch (error) {
      // The task changed; the post just still shows the old buttons.
      this.logger.warn({ err: describe(error), taskId }, 'Could not update the Slack post');
    }
  }

  // -------------------------------------------------------------------------

  /** The CoreTask person behind a Slack account, while they still belong to the workspace. */
  private async actorFor(
    installation: SlackInstallation,
    slackUserId: string,
  ): Promise<ActorContext | null> {
    const link = await this.prisma.slackUserLink.findUnique({
      where: {
        installationId_slackUserId: { installationId: installation.id, slackUserId },
      },
      select: { userId: true },
    });
    if (!link) return null;
    const membership = await this.prisma.workspaceMember.findUnique({
      where: {
        workspaceId_userId: { workspaceId: installation.workspaceId, userId: link.userId },
        deactivatedAt: null,
      },
      select: { role: true },
    });
    if (!membership) return null;
    return { userId: link.userId, role: membership.role as WorkspaceRole };
  }

  /** A small modal in answer to a click; the click's trigger is the only way to show one. */
  private async notice(
    token: string,
    payload: Interaction,
    title: string,
    blocks: unknown[],
  ): Promise<void> {
    if (!payload.trigger_id) return;
    try {
      await this.slack.openView(token, payload.trigger_id, noticeModal(title, blocks));
    } catch (error) {
      this.logger.warn({ err: describe(error) }, 'Could not open a Slack notice');
    }
  }

  private taskUrl(task: { id: string; projectId: string | null }): string {
    const web = this.installations.webUrl;
    return task.projectId
      ? `${web}/projects/${task.projectId}/list?task=${task.id}`
      : `${web}/my-tasks?task=${task.id}`;
  }
}

const NOT_CONNECTED =
  'This Slack workspace is not connected to CoreTask. A CoreTask admin can connect it in Integrations › Slack.';

function ephemeral(message: string | { text: string; blocks?: unknown[] }): SlackReply {
  const body = typeof message === 'string' ? { text: message } : message;
  return { response_type: 'ephemeral', ...body };
}

function formErrors(block: string, message: string): SlackReply {
  return { response_action: 'errors', errors: { [block]: message.slice(0, 150) } };
}

function noticeModal(title: string, blocks: unknown[]): Record<string, unknown> {
  return {
    type: 'modal',
    title: { type: 'plain_text', text: title.slice(0, 24) },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  };
}

function parseMetadata(raw: string | undefined): CreateTaskMetadata {
  try {
    const parsed = JSON.parse(raw ?? '{}') as Partial<CreateTaskMetadata>;
    return { channelId: typeof parsed.channelId === 'string' ? parsed.channelId : null };
  } catch {
    return { channelId: null };
  }
}

function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function describe(error: unknown): string {
  if (error instanceof SlackApiError) return error.error;
  return error instanceof Error ? error.message : String(error);
}
