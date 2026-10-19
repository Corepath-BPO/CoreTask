import { timingSafeEqual } from 'node:crypto';

import {
  AttachmentStatus,
  INBOUND_EMAIL_BODY_MAX,
  InboundEmailOutcome,
  InboundEmailSender,
  MAX_INBOUND_ATTACHMENTS,
  MAX_TASK_EMAIL_RECIPIENTS,
  TASK_TITLE_MAX_LENGTH,
  WorkspaceRole,
  hasAtLeastRole,
  parseAddressList,
  readInboundAddress,
  stripQuotedReply,
} from '@coretask/contracts';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type ProjectEmailInbox } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { escapeHtml, plainTextToHtml } from '../../common/utils/rich-text.util';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { CommentsService } from '../comments/comments.service';
import { FollowersService } from '../followers/followers.service';
import { ProjectAccessService } from '../project-access/project-access.service';
import { TasksService } from '../tasks/tasks.service';

import type { InboundAttachment, InboundMessage } from './inbound-message';

/** What became of a message at one project address. */
export interface InboundResult {
  address: string;
  /** UNKNOWN: no project has that address. DUPLICATE: already taken once. */
  outcome: InboundEmailOutcome | 'UNKNOWN' | 'DUPLICATE';
  reason?: string;
  taskId?: string | null;
}

/** Project addresses one message may reach; past it, the rest are ignored. */
const MAX_TARGETS = 5;
/** Received messages remembered per project, for the panel and for retries. */
const KEEP_RECORDS = 100;

/** A refusal: recorded against the project, shown in the panel, never retried. */
class Refusal extends Error {}

/**
 * Mail arriving at project addresses, as a mail provider posts it.
 *
 * A message to `<token>@` becomes a task; to `<token>+<task>@` (an update's
 * reply address) a comment on that task. A member sender acts as themselves.
 * Anyone else is taken only when the project accepts mail from anyone — or,
 * for a reply, when they were on the task's email thread — and their words
 * are credited to whoever set the address up, saying who really sent them.
 *
 * The From header can be forged; MEMBERS mode trusts it no more than the
 * provider's own checks do (SPF, DKIM, DMARC), which is worth configuring.
 */
@Injectable()
export class InboundEmailService {
  private readonly logger = new Logger(InboundEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly access: ProjectAccessService,
    private readonly tasks: TasksService,
    private readonly comments: CommentsService,
    private readonly followers: FollowersService,
    private readonly storage: StorageService,
  ) {}

  /** The provider's proof: HTTP Basic auth's password, or `X-Inbound-Secret`. */
  authorize(authorization: string | undefined, headerSecret: string | undefined): void {
    const { enabled, secret } = this.config.inboundEmail;
    if (!enabled || !secret) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'This server does not receive email.');
    }
    let offered = headerSecret ?? '';
    if (!offered && authorization?.startsWith('Basic ')) {
      const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
      offered = decoded.slice(decoded.indexOf(':') + 1);
    }
    const a = Buffer.from(offered);
    const b = Buffer.from(secret);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw AppException.unauthorized('UNAUTHORIZED', 'The inbound email secret is wrong.');
    }
  }

  async receive(message: InboundMessage): Promise<InboundResult[]> {
    const domain = this.config.inboundEmail.domain as string;
    const targets = new Map<string, { address: string; token: string; taskId: string | null }>();
    for (const address of message.recipients) {
      const read = readInboundAddress(address, domain);
      if (read && !targets.has(read.token)) targets.set(read.token, { address, ...read });
    }

    const results: InboundResult[] = [];
    for (const target of [...targets.values()].slice(0, MAX_TARGETS)) {
      results.push(await this.deliver(target, message, domain));
    }
    return results;
  }

  // -------------------------------------------------------------------------

  private async deliver(
    target: { address: string; token: string; taskId: string | null },
    message: InboundMessage,
    domain: string,
  ): Promise<InboundResult> {
    const inbox = await this.prisma.projectEmailInbox.findUnique({
      where: { token: target.token },
      include: { project: { select: { archivedAt: true } } },
    });
    if (!inbox) return { address: target.address, outcome: 'UNKNOWN' };

    /*
     * The record comes first and its Message-ID is unique per project, so a
     * provider's retry — even one racing the original — stops here rather
     * than making a second task.
     */
    let recordId: string;
    try {
      recordId = (
        await this.prisma.inboundEmail.create({
          data: {
            workspaceId: inbox.workspaceId,
            projectId: inbox.projectId,
            messageId: message.messageId?.slice(0, 998) ?? null,
            fromAddress: (message.from ?? '(no sender)').slice(0, 320),
            subject: (message.subject || '(no subject)').slice(0, 500),
            outcome: InboundEmailOutcome.REJECTED,
            reason: 'Still being read.',
          },
        })
      ).id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { address: target.address, outcome: 'DUPLICATE' };
      }
      throw error;
    }

    try {
      if (!inbox.isActive || inbox.project.archivedAt) {
        throw new Refusal('The address is turned off.');
      }
      const from = message.from;
      if (!from) throw new Refusal('The message has no sender.');
      if (from.endsWith(`@${domain}`))
        throw new Refusal('Mail from a project address is not taken.');

      const sender = await this.memberActor(inbox, from);
      const done = target.taskId
        ? await this.reply(inbox, message, from, sender, target.taskId, domain)
        : await this.newTask(inbox, message, from, sender, domain);

      await this.settle(recordId, inbox, done.outcome, null, done.taskId);
      return { address: target.address, ...done };
    } catch (error) {
      // A refusal, or a request the app itself turned down, is final: say so
      // and keep the record, or the provider would retry it forever.
      const final =
        error instanceof Refusal || (error instanceof HttpException && error.getStatus() < 500);
      if (!final) {
        await this.prisma.inboundEmail.delete({ where: { id: recordId } }).catch(() => undefined);
        throw error;
      }
      const reason = (error as Error).message.slice(0, 300);
      await this.settle(recordId, inbox, InboundEmailOutcome.REJECTED, reason, null);
      return { address: target.address, outcome: InboundEmailOutcome.REJECTED, reason };
    }
  }

  private async newTask(
    inbox: ProjectEmailInbox,
    message: InboundMessage,
    from: string,
    sender: ActorContext | null,
    domain: string,
  ): Promise<{ outcome: InboundEmailOutcome; taskId: string }> {
    let actor = sender;
    if (!actor) {
      if (inbox.acceptFrom !== InboundEmailSender.ANYONE) {
        throw new Refusal('Only members of the workspace can email this project.');
      }
      actor = await this.credit(inbox);
    }

    const { kept, skipped } = this.sortAttachments(message.attachments);
    const parts: string[] = [];
    const text = message.text.slice(0, INBOUND_EMAIL_BODY_MAX).trim();
    if (text) parts.push(plainTextToHtml(text));
    if (!sender) parts.push(`<p><em>Emailed by ${escapeHtml(from)}.</em></p>`);
    if (skipped.length > 0) {
      parts.push(`<p><em>Not kept from the email: ${escapeHtml(skipped.join(', '))}.</em></p>`);
    }

    const sectionId = await this.sectionFor(inbox);
    const task = await this.tasks.create(inbox.workspaceId, actor, {
      title: (message.subject || '(no subject)').slice(0, TASK_TITLE_MAX_LENGTH),
      ...(parts.length > 0 ? { description: parts.join('') } : {}),
      projectId: inbox.projectId,
      ...(sectionId ? { sectionId } : {}),
    });

    await this.attach(inbox.workspaceId, task.id, actor.userId, kept);
    await this.joinThread(inbox, task.id, message, from, domain);
    return { outcome: InboundEmailOutcome.TASK_CREATED, taskId: task.id };
  }

  private async reply(
    inbox: ProjectEmailInbox,
    message: InboundMessage,
    from: string,
    sender: ActorContext | null,
    taskId: string,
    domain: string,
  ): Promise<{ outcome: InboundEmailOutcome; taskId: string }> {
    const task = await this.prisma.task.findFirst({
      where: {
        id: taskId,
        OR: [
          { projectId: inbox.projectId },
          { projectLinks: { some: { projectId: inbox.projectId } } },
        ],
      },
      select: { id: true },
    });
    if (!task) throw new Refusal('That task is not in this project.');

    let actor = sender;
    let lead = '';
    if (!actor) {
      const onThread = await this.prisma.taskEmailRecipient.findUnique({
        where: { taskId_address: { taskId, address: from } },
      });
      if (!onThread && inbox.acceptFrom !== InboundEmailSender.ANYONE) {
        throw new Refusal('Only members and people on the email thread can reply.');
      }
      actor = await this.credit(inbox);
      lead = `<p><em>${escapeHtml(from)} replied by email:</em></p>`;
    }

    const { kept, skipped } = this.sortAttachments(message.attachments);
    const words = stripQuotedReply(message.text).slice(0, INBOUND_EMAIL_BODY_MAX).trim();
    if (!words && kept.length === 0) throw new Refusal('The reply is empty.');

    const attachmentIds = await this.attach(inbox.workspaceId, taskId, actor.userId, kept);
    const parts = [lead, plainTextToHtml(words || 'Sent files by email.')];
    if (skipped.length > 0) {
      parts.push(`<p><em>Not kept from the email: ${escapeHtml(skipped.join(', '))}.</em></p>`);
    }
    await this.comments.createForTask(
      inbox.workspaceId,
      actor,
      taskId,
      { body: parts.join(''), ...(attachmentIds.length > 0 ? { attachmentIds } : {}) },
      from,
    );

    await this.joinThread(inbox, taskId, message, from, domain);
    return { outcome: InboundEmailOutcome.COMMENTED, taskId };
  }

  /**
   * Everyone on the message joins the task's thread: members as
   * collaborators, everyone else as a recipient of its updates — each only
   * when the project asks for it.
   */
  private async joinThread(
    inbox: ProjectEmailInbox,
    taskId: string,
    message: InboundMessage,
    from: string,
    domain: string,
  ): Promise<void> {
    const addresses = parseAddressList([from], message.to, message.cc).filter(
      (address) => !address.endsWith(`@${domain}`),
    );
    if (addresses.length === 0) return;

    const members = await this.membersByAddress(inbox.workspaceId, addresses);
    if (inbox.addCollaborators && members.size > 0) {
      await this.followers.ensure(inbox.workspaceId, { taskId, ticketId: null }, [
        ...members.values(),
      ]);
    }

    if (inbox.sendUpdates) {
      const outsiders = addresses.filter((address) => !members.has(address));
      const already = await this.prisma.taskEmailRecipient.count({ where: { taskId } });
      const room = Math.max(0, MAX_TASK_EMAIL_RECIPIENTS - already);
      if (outsiders.length > 0 && room > 0) {
        await this.prisma.taskEmailRecipient.createMany({
          data: outsiders
            .slice(0, room)
            .map((address) => ({ taskId, address, projectId: inbox.projectId })),
          skipDuplicates: true,
        });
      }
    }
  }

  /** Files allowed in as attachments, and the names of those left out. */
  private sortAttachments(files: InboundAttachment[]) {
    const kept: InboundAttachment[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const filename = file.filename.replace(/[\\/]/g, '_').slice(0, 255) || 'attachment';
      if (kept.length >= MAX_INBOUND_ATTACHMENTS) {
        skipped.push(filename);
        continue;
      }
      try {
        this.storage.assertUploadAllowed({
          filename,
          mimeType: file.mimeType,
          sizeBytes: file.content.length,
        });
        kept.push({ ...file, filename, mimeType: file.mimeType.split(';')[0]?.trim() ?? '' });
      } catch {
        skipped.push(filename);
      }
    }
    return { kept, skipped };
  }

  /** Stores the files on the task; the ids of those that made it. */
  private async attach(
    workspaceId: string,
    taskId: string,
    uploaderId: string,
    files: InboundAttachment[],
  ): Promise<string[]> {
    const ids: string[] = [];
    for (const file of files) {
      const objectKey = this.storage.buildObjectKey(workspaceId, file.filename);
      try {
        await this.storage.putObject(objectKey, file.content, file.mimeType);
        const row = await this.prisma.attachment.create({
          data: {
            workspaceId,
            uploaderId,
            taskId,
            filename: file.filename,
            mimeType: file.mimeType,
            sizeBytes: file.content.length,
            objectKey,
            status: AttachmentStatus.READY,
          },
          select: { id: true },
        });
        ids.push(row.id);
      } catch (error) {
        this.logger.warn(
          { err: error, taskId, filename: file.filename },
          'Could not keep an emailed file',
        );
      }
    }
    return ids;
  }

  /** The sender, acting as themselves, when they may edit the project. */
  private async memberActor(inbox: ProjectEmailInbox, email: string): Promise<ActorContext | null> {
    const members = await this.membersByAddress(inbox.workspaceId, [email]);
    const userId = members.get(email);
    if (!userId) return null;
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId: inbox.workspaceId, userId },
      select: { userId: true, role: true },
    });
    if (!member) return null;
    const actor = { userId: member.userId, role: member.role } as ActorContext;
    const access = await this.access.findAccess(inbox.workspaceId, inbox.projectId, actor);
    return access && hasAtLeastRole(access.effectiveRole, WorkspaceRole.MEMBER) ? actor : null;
  }

  /** Lowercase address → user id, for the workspace's members among them. */
  private async membersByAddress(workspaceId: string, addresses: string[]) {
    const rows = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        user: { email: { in: addresses, mode: 'insensitive' } },
      },
      select: { userId: true, user: { select: { email: true } } },
    });
    return new Map(rows.map((row) => [row.user.email.toLowerCase(), row.userId]));
  }

  /** Whose name a stranger's mail goes under: the address's author, else the owner. */
  private async credit(inbox: ProjectEmailInbox): Promise<ActorContext> {
    const author = inbox.createdById
      ? await this.prisma.workspaceMember.findFirst({
          where: { workspaceId: inbox.workspaceId, userId: inbox.createdById },
          select: { userId: true, role: true },
        })
      : null;
    const member =
      author ??
      (await this.prisma.workspaceMember.findFirst({
        where: { workspaceId: inbox.workspaceId, role: WorkspaceRole.OWNER },
        orderBy: { createdAt: 'asc' },
        select: { userId: true, role: true },
      }));
    if (!member) throw new Refusal('Nobody in the workspace can take this mail.');
    return { userId: member.userId, role: member.role } as ActorContext;
  }

  private async sectionFor(inbox: ProjectEmailInbox): Promise<string | null> {
    if (inbox.sectionId) {
      const chosen = await this.prisma.section.findFirst({
        where: { id: inbox.sectionId, projectId: inbox.projectId },
        select: { id: true },
      });
      if (chosen) return chosen.id;
    }
    const first = await this.prisma.section.findFirst({
      where: { projectId: inbox.projectId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    return first?.id ?? null;
  }

  /** Writes the outcome, counts the message, and forgets the oldest records. */
  private async settle(
    recordId: string,
    inbox: ProjectEmailInbox,
    outcome: InboundEmailOutcome,
    reason: string | null,
    taskId: string | null,
  ): Promise<void> {
    await this.prisma.inboundEmail.update({
      where: { id: recordId },
      data: { outcome, reason, taskId },
    });
    await this.prisma.projectEmailInbox.update({
      where: { id: inbox.id },
      data: { receivedCount: { increment: 1 } },
    });
    const stale = await this.prisma.inboundEmail.findMany({
      where: { projectId: inbox.projectId },
      orderBy: { receivedAt: 'desc' },
      skip: KEEP_RECORDS,
      select: { id: true },
    });
    if (stale.length > 0) {
      await this.prisma.inboundEmail.deleteMany({
        where: { id: { in: stale.map((row) => row.id) } },
      });
    }
  }
}
