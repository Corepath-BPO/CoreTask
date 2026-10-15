import {
  ActivityAction,
  ActivityEntity,
  NotificationType,
  PROJECT_FEED_PAGE_SIZE,
  PROJECT_STATUS_LABEL,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type {
  PostProjectMessagePayload,
  PostStatusUpdatePayload,
  StatusRequestResult,
  ProjectFile,
  ProjectMessage,
  ProjectStatusDraft,
  ProjectStatusUpdate,
  UpdateAuthor,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { htmlToText, normalizeRichText } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectAccessService } from '../project-access/project-access.service';
import { WebhookDeliveryService } from '../webhooks/webhook-delivery.service';

import { askedRecently } from './status-request';

const authorSelect = { select: { id: true, name: true, avatarUrl: true } } as const;

const messageInclude = {
  author: authorSelect,
  replies: { orderBy: { createdAt: 'asc' }, include: { author: authorSelect } },
} satisfies Prisma.ProjectMessageInclude;

type MessageRow = Prisma.ProjectMessageGetPayload<{ include: typeof messageInclude }>;
type StatusRow = Prisma.ProjectStatusUpdateGetPayload<{ include: { author: typeof authorSelect } }>;

const toAuthor = (user: UpdateAuthor | null): UpdateAuthor | null =>
  user ? { id: user.id, name: user.name, avatarUrl: user.avatarUrl } : null;

function toStatusDraft(row: {
  id: string;
  projectId: string;
  status: ProjectStatusDraft['status'];
  title: string;
  summary: string | null;
  nextSteps: string | null;
  createdAt: Date;
  rule: { id: string; name: string } | null;
}): ProjectStatusDraft {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    title: row.title,
    summary: row.summary,
    nextSteps: row.nextSteps,
    rule: row.rule,
    createdAt: row.createdAt.toISOString(),
  };
}

function toStatusUpdate(row: StatusRow): ProjectStatusUpdate {
  return {
    id: row.id,
    projectId: row.projectId,
    status: row.status,
    title: row.title,
    summary: row.summary,
    nextSteps: row.nextSteps,
    author: toAuthor(row.author),
    createdAt: row.createdAt.toISOString(),
  };
}

function toMessage(row: MessageRow): ProjectMessage {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    body: row.body,
    author: toAuthor(row.author),
    replies: row.replies.map((reply) => ({
      id: reply.id,
      body: reply.body,
      author: toAuthor(reply.author),
      createdAt: reply.createdAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Status updates, messages and files — what a project says about itself.
 *
 * Reading follows the project's visibility like everything else in it.
 * Posting is for whoever can edit its tasks, as in Asana where a commenter
 * cannot set the status; deleting is the author's, or a manager's.
 *
 * Posting tells the project's members, minus the author: a status update is
 * written to be read, and the inbox is where somebody finds out it exists.
 */
@Injectable()
export class ProjectUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly activity: ActivityLogsService,
    private readonly notifications: NotificationDispatcher,
    private readonly deliveries: WebhookDeliveryService,
  ) {}

  private readonly logger = new Logger(ProjectUpdatesService.name);

  // -------------------------------------------------------------------------
  // Status updates
  // -------------------------------------------------------------------------

  async listStatusUpdates(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectStatusUpdate[]> {
    await this.requireVisible(workspaceId, projectId, actor);

    const rows = await this.prisma.projectStatusUpdate.findMany({
      where: { projectId },
      include: { author: authorSelect },
      orderBy: { createdAt: 'desc' },
      take: PROJECT_FEED_PAGE_SIZE,
    });
    return rows.map(toStatusUpdate);
  }

  /**
   * The newest update of every project the caller can see — the status the
   * project list, the portfolios and the header show.
   */
  async latestStatusUpdates(
    workspaceId: string,
    actor: ActorContext,
  ): Promise<ProjectStatusUpdate[]> {
    const rows = await this.prisma.projectStatusUpdate.findMany({
      where: {
        workspaceId,
        project: { archivedAt: null, AND: [this.access.projectWhere(actor)] },
      },
      include: { author: authorSelect },
      orderBy: [{ projectId: 'asc' }, { createdAt: 'desc' }],
      distinct: ['projectId'],
    });
    return rows.map(toStatusUpdate);
  }

  async postStatusUpdate(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    payload: PostStatusUpdatePayload,
  ): Promise<ProjectStatusUpdate> {
    const project = await this.requireEditor(workspaceId, projectId, actor);

    const [row] = await this.prisma.$transaction([
      this.prisma.projectStatusUpdate.create({
        data: {
          workspaceId,
          projectId,
          authorId: actor.userId,
          status: payload.status,
          title: payload.title.trim(),
          summary: payload.summary?.trim() || null,
          nextSteps: payload.nextSteps?.trim() || null,
        },
        include: { author: authorSelect },
      }),
      // A draft waiting from a rule's AI step is spent: whether this post took
      // its words or not, the project has a fresher word on itself now.
      this.prisma.projectStatusDraft.deleteMany({ where: { projectId } }),
    ]);

    const label = PROJECT_STATUS_LABEL[payload.status];
    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      projectId,
      summary: `Posted a status update: ${label}`,
      metadata: { statusUpdateId: row.id, status: payload.status },
    });

    await this.tellMembers(workspaceId, projectId, actor.userId, {
      title: `${row.author?.name ?? 'Somebody'} set ${project.name} to ${label}`,
      body: row.title,
    });

    // To the project's chat apps and the workspace's webhooks that asked. A
    // channel that cannot be reached must not stop the update being posted.
    await this.deliveries
      .fanOutStatusUpdate({
        workspaceId,
        projectId,
        actorId: actor.userId,
        update: {
          id: row.id,
          status: row.status,
          title: row.title,
          summary: row.summary,
          nextSteps: row.nextSteps,
          createdAt: row.createdAt.toISOString(),
        },
      })
      .catch((error: unknown) =>
        this.logger.warn({ err: error, projectId }, 'Could not queue the status update for apps'),
      );

    return toStatusUpdate(row);
  }

  /**
   * The update a rule's "Draft an update with AI…" step left for review, or
   * null. Only for those who could post it: a draft is not the project's
   * status, and a reader would take it for one.
   */
  async getStatusDraft(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectStatusDraft | null> {
    await this.requireEditor(workspaceId, projectId, actor);
    const row = await this.prisma.projectStatusDraft.findUnique({
      where: { projectId },
      include: { rule: { select: { id: true, name: true } } },
    });
    return row ? toStatusDraft(row) : null;
  }

  /** Throws the draft away without posting it. */
  async discardStatusDraft(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.prisma.projectStatusDraft.deleteMany({ where: { projectId } });
  }

  /**
   * "Request status update": tells the project's owner that someone wants to
   * know how it is going. Anyone who can see the project may ask. With no
   * owner, whoever posted its last update is asked instead.
   */
  async requestStatusUpdate(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<StatusRequestResult> {
    await this.requireVisible(workspaceId, projectId, actor);
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        name: true,
        lead: { select: { id: true, name: true } },
        statusUpdates: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { author: { select: { id: true, name: true } } },
        },
      },
    });
    const recipient = project.lead ?? project.statusUpdates[0]?.author ?? null;
    if (!recipient) {
      throw AppException.badRequest('BAD_REQUEST', 'This project has no owner to ask yet.');
    }
    if (recipient.id === actor.userId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'You own this project — post the update yourself.',
      );
    }

    const asker = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { name: true },
    });
    const title = `${asker.name} asked for a status update on ${project.name}`.slice(0, 200);
    if (!(await askedRecently(this.prisma, recipient.id, title))) {
      await this.notifications.dispatch({
        userId: recipient.id,
        workspaceId,
        type: NotificationType.PROJECT_UPDATE,
        title,
        body: 'Set the project’s status from its header.',
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        actionUrl: `/projects/${projectId}`,
      });
    }
    return { recipient: { id: recipient.id, name: recipient.name } };
  }

  async deleteStatusUpdate(
    workspaceId: string,
    projectId: string,
    updateId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requireVisible(workspaceId, projectId, actor);

    const row = await this.prisma.projectStatusUpdate.findFirst({
      where: { id: updateId, projectId, workspaceId },
      select: { id: true, authorId: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Status update not found.');

    await this.assertAuthorOrManager(projectId, actor, row.authorId);
    await this.prisma.projectStatusUpdate.delete({ where: { id: row.id } });
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  async listMessages(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectMessage[]> {
    await this.requireVisible(workspaceId, projectId, actor);

    const rows = await this.prisma.projectMessage.findMany({
      where: { projectId },
      include: messageInclude,
      orderBy: { createdAt: 'desc' },
      take: PROJECT_FEED_PAGE_SIZE,
    });
    return rows.map(toMessage);
  }

  async postMessage(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    payload: PostProjectMessagePayload,
  ): Promise<ProjectMessage> {
    const project = await this.requireEditor(workspaceId, projectId, actor);

    const body = normalizeRichText(payload.body);
    if (!body) throw AppException.badRequest('BAD_REQUEST', 'Write something in the message.');

    const row = await this.prisma.projectMessage.create({
      data: {
        workspaceId,
        projectId,
        authorId: actor.userId,
        title: payload.title.trim(),
        body,
      },
      include: messageInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      projectId,
      summary: `Posted a message: ${row.title}`,
      metadata: { messageId: row.id },
    });

    await this.tellMembers(workspaceId, projectId, actor.userId, {
      title: `${row.author?.name ?? 'Somebody'} posted in ${project.name}: ${row.title}`,
      body: htmlToText(body).slice(0, 200),
    });

    return toMessage(row);
  }

  async deleteMessage(
    workspaceId: string,
    projectId: string,
    messageId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requireVisible(workspaceId, projectId, actor);

    const row = await this.prisma.projectMessage.findFirst({
      where: { id: messageId, projectId, workspaceId },
      select: { id: true, authorId: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Message not found.');

    await this.assertAuthorOrManager(projectId, actor, row.authorId);
    await this.prisma.projectMessage.delete({ where: { id: row.id } });
  }

  /**
   * A reply, which tells the people already in the conversation — the
   * message's author and whoever replied before — rather than the whole
   * project again.
   */
  async reply(
    workspaceId: string,
    projectId: string,
    messageId: string,
    actor: ActorContext,
    text: string,
  ): Promise<ProjectMessage> {
    const project = await this.requireEditor(workspaceId, projectId, actor);

    const message = await this.prisma.projectMessage.findFirst({
      where: { id: messageId, projectId, workspaceId },
      select: { id: true, title: true, authorId: true, replies: { select: { authorId: true } } },
    });
    if (!message) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Message not found.');

    const body = normalizeRichText(text);
    if (!body) throw AppException.badRequest('BAD_REQUEST', 'Write something in the reply.');

    await this.prisma.projectMessageReply.create({
      data: { messageId: message.id, authorId: actor.userId, body },
    });

    const author = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { name: true },
    });
    const audience = new Set(
      [message.authorId, ...message.replies.map((reply) => reply.authorId)].filter(
        (id): id is string => id !== null && id !== actor.userId,
      ),
    );
    for (const userId of audience) {
      await this.notifications.dispatch({
        userId,
        workspaceId,
        type: NotificationType.PROJECT_UPDATE,
        title: `${author?.name ?? 'Somebody'} replied to “${message.title}” in ${project.name}`,
        body: htmlToText(body).slice(0, 200),
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        actionUrl: `/projects/${projectId}/messages`,
      });
    }

    const row = await this.prisma.projectMessage.findUniqueOrThrow({
      where: { id: message.id },
      include: messageInclude,
    });
    return toMessage(row);
  }

  // -------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------

  /** Every finished upload on the project's tasks, newest first. */
  async listFiles(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectFile[]> {
    await this.requireVisible(workspaceId, projectId, actor);

    const rows = await this.prisma.attachment.findMany({
      where: {
        workspaceId,
        status: 'READY',
        task: { projectId, archivedAt: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        createdAt: true,
        uploader: authorSelect,
        task: { select: { id: true, title: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      createdAt: row.createdAt.toISOString(),
      uploader: toAuthor(row.uploader),
      task: row.task,
    }));
  }

  // -------------------------------------------------------------------------

  private async requireVisible(workspaceId: string, projectId: string, actor: ActorContext) {
    const access = await this.access.findAccess(workspaceId, projectId, actor);
    if (!access) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
  }

  /** Visible, and editable by the caller. Returns the project's name for the notices. */
  private async requireEditor(workspaceId: string, projectId: string, actor: ActorContext) {
    await this.requireVisible(workspaceId, projectId, actor);
    await this.access.assertEffectiveRole(projectId, actor, WorkspaceRole.MEMBER);

    return this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { name: true },
    });
  }

  private async assertAuthorOrManager(
    projectId: string,
    actor: ActorContext,
    authorId: string | null,
  ): Promise<void> {
    if (authorId === actor.userId) return;

    const effective = await this.access.effectiveRoleFor(projectId, actor);
    if (!hasAtLeastRole(effective, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden('FORBIDDEN', 'Only the author or a manager can delete this.');
    }
  }

  /** The project's roster, minus whoever posted. */
  private async tellMembers(
    workspaceId: string,
    projectId: string,
    authorId: string,
    notice: { title: string; body: string },
  ): Promise<void> {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId, userId: { not: authorId } },
      select: { userId: true },
    });

    for (const member of members) {
      await this.notifications.dispatch({
        userId: member.userId,
        workspaceId,
        type: NotificationType.PROJECT_UPDATE,
        title: notice.title.slice(0, 200),
        body: notice.body,
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        actionUrl: `/projects/${projectId}/messages`,
      });
    }
  }
}
