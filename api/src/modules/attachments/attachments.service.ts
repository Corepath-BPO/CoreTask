import {
  ActivityAction,
  ActivityEntity,
  AttachmentStatus,
  INLINE_IMAGE_MIME_TYPES,
  MAX_ATTACHMENTS_PER_ITEM,
  ServerEvent,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { Attachment, AttachmentDownload, PresignedUpload } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Attachment as PrismaAttachment } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { TasksService } from '../tasks/tasks.service';
import { TicketsService } from '../tickets/tickets.service';

import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { taskInclude, toTaskDto } from '../tasks/task.mapper';
import { ticketInclude, toTicketDto } from '../tickets/ticket.mapper';

import { attachmentInclude, toAttachmentDto } from './attachment.mapper';
import type { CreateAttachmentDto } from './dto/attachment.dto';

/** Where an attachment hangs, once the parent has been proven to be in scope. */
interface AttachmentParent {
  link: { taskId: string | null; ticketId: string | null };
  label: string;
}

@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly activity: ActivityLogsService,
    private readonly tasks: TasksService,
    private readonly tickets: TicketsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * A file arriving or leaving changes the clip count on the row and the card,
   * so the item is announced the way a field edit is — to the workspace for
   * the task and ticket listeners, and to the project room for the List and
   * Board, which read `work-item:*`.
   */
  private async announceParent(attachment: {
    workspaceId: string;
    taskId: string | null;
    ticketId: string | null;
  }): Promise<void> {
    try {
      if (attachment.taskId) {
        const task = await this.prisma.task.findUnique({
          where: { id: attachment.taskId },
          include: taskInclude,
        });
        if (!task) return;
        this.realtime.emitToWorkspace(
          attachment.workspaceId,
          ServerEvent.TASK_UPDATED,
          toTaskDto(task),
        );
        if (task.projectId) {
          this.realtime.emitToProject(task.projectId, ServerEvent.WORK_ITEM_UPDATED, {
            workspaceId: attachment.workspaceId,
            projectId: task.projectId,
            occurredAt: new Date().toISOString(),
          });
        }
      } else if (attachment.ticketId) {
        const ticket = await this.prisma.ticket.findUnique({
          where: { id: attachment.ticketId },
          include: ticketInclude,
        });
        if (!ticket) return;
        this.realtime.emitToWorkspace(
          attachment.workspaceId,
          ServerEvent.TICKET_UPDATED,
          toTicketDto(ticket),
        );
        if (ticket.projectId) {
          this.realtime.emitToProject(ticket.projectId, ServerEvent.WORK_ITEM_UPDATED, {
            workspaceId: attachment.workspaceId,
            projectId: ticket.projectId,
            occurredAt: new Date().toISOString(),
          });
        }
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not announce an attachment change');
    }
  }

  /**
   * Reserves a row and hands back somewhere to PUT the bytes.
   *
   * Nothing here is trusted about the file itself. The declared size and type
   * shape the presigned URL and give the uploader a fast, useful error, but the
   * upload goes straight to the bucket, so the only claim that ever becomes
   * fact is the one {@link confirm} re-reads from storage.
   */
  async create(
    workspaceId: string,
    userId: string,
    dto: CreateAttachmentDto,
  ): Promise<PresignedUpload> {
    const parent = await this.resolveParent(workspaceId, dto);

    this.storage.assertUploadAllowed({
      filename: dto.filename,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
    });

    await this.assertCapacity(workspaceId, parent);

    const objectKey = this.storage.buildObjectKey(workspaceId, dto.filename);

    const attachment = await this.prisma.attachment.create({
      data: {
        workspaceId,
        uploaderId: userId,
        taskId: parent.link.taskId,
        ticketId: parent.link.ticketId,
        filename: dto.filename,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        objectKey,
        status: AttachmentStatus.PENDING,
      },
      include: attachmentInclude,
    });

    const upload = await this.storage.presignUpload(objectKey, dto.mimeType);

    return {
      attachment: toAttachmentDto(attachment),
      uploadUrl: upload.url,
      uploadHeaders: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
    };
  }

  /**
   * Turns a reservation into a real attachment, after checking what landed.
   *
   * This is the security boundary of the whole feature. A presigned PUT cannot
   * enforce a size limit — S3 and MinIO have no way to express one on a signed
   * URL — so a URL issued for a 2 KB image will happily accept a gigabyte.
   * Reading the object back is what makes the recorded size true.
   *
   * A mismatch deletes the object rather than leaving it to the sweeper: it is
   * already known to be unwanted, and paying for it until a cron notices would
   * be the wrong default.
   */
  async confirm(workspaceId: string, userId: string, attachmentId: string): Promise<Attachment> {
    const attachment = await this.requireAttachment(workspaceId, attachmentId, {
      includePending: true,
    });

    if (attachment.status === AttachmentStatus.READY) {
      return this.read(attachmentId);
    }

    if (attachment.uploaderId !== userId) {
      throw AppException.forbidden('FORBIDDEN', 'Only the uploader can confirm an upload.');
    }

    const stored = await this.storage.headObject(attachment.objectKey);

    if (!stored) {
      throw AppException.badRequest('BAD_REQUEST', 'No file was uploaded for this attachment.');
    }

    try {
      // Re-validated against the same rules as the declaration, because this is
      // the first point at which the values are evidence rather than a request.
      this.storage.assertUploadAllowed({
        filename: attachment.filename,
        mimeType: stored.mimeType || attachment.mimeType,
        sizeBytes: stored.sizeBytes,
      });
    } catch (error) {
      await this.discard(attachment);
      throw error;
    }

    if (stored.mimeType && stored.mimeType !== attachment.mimeType) {
      await this.discard(attachment);
      throw AppException.badRequest(
        'BAD_REQUEST',
        'The uploaded file does not match the type it was declared as.',
      );
    }

    const ready = await this.prisma.attachment.update({
      where: { id: attachmentId },
      // The stored size replaces the declared one outright.
      data: { status: AttachmentStatus.READY, sizeBytes: stored.sizeBytes },
      include: attachmentInclude,
    });

    // Filed under the task or ticket, which is the feed somebody reads it in;
    // the file's own id rides in the metadata for the audit trail.
    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.ATTACHED,
      entity: attachment.taskId ? ActivityEntity.TASK : ActivityEntity.TICKET,
      entityId: (attachment.taskId ?? attachment.ticketId) as string,
      summary: `Attached "${attachment.filename}"`,
      metadata: {
        attachmentId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: stored.sizeBytes,
      },
    });

    this.logger.log(
      { workspaceId, attachmentId, sizeBytes: stored.sizeBytes },
      'Attachment confirmed',
    );

    await this.announceParent(ready);

    return toAttachmentDto(ready);
  }

  async listForTask(workspaceId: string, taskId: string): Promise<Attachment[]> {
    const task = await this.tasks.requireTask(workspaceId, taskId);
    return this.listFor({ taskId: task.id });
  }

  async listForTicket(workspaceId: string, idOrKey: string): Promise<Attachment[]> {
    const ticket = await this.tickets.requireTicket(workspaceId, idOrKey);
    return this.listFor({ ticketId: ticket.id });
  }

  /**
   * A short-lived URL for one file.
   *
   * Deliberately not a permanent link: the bucket is private, so possession of a
   * URL is possession of the file, and a link that never expires would outlive
   * the membership that justified it.
   */
  async download(workspaceId: string, attachmentId: string): Promise<AttachmentDownload> {
    const attachment = await this.requireAttachment(workspaceId, attachmentId);
    return this.storage.presignDownload(attachment.objectKey, attachment.filename);
  }

  /**
   * A short-lived URL for showing an image in place — a description's inline
   * picture. The description stores only the attachment's id, never a URL, so
   * this is asked for at render time by whoever is looking.
   *
   * Raster images only. The download route is the honest path for anything
   * else, and the only path for an SVG, which can carry script.
   */
  async view(workspaceId: string, attachmentId: string): Promise<AttachmentDownload> {
    const attachment = await this.requireAttachment(workspaceId, attachmentId);

    if (!INLINE_IMAGE_MIME_TYPES.includes(attachment.mimeType)) {
      throw AppException.badRequest(
        'UNSUPPORTED_MEDIA_TYPE',
        'Only images can be shown inline; download this file instead.',
        { allowed: INLINE_IMAGE_MIME_TYPES, actual: attachment.mimeType },
      );
    }

    return this.storage.presignView(attachment.objectKey, attachment.mimeType);
  }

  async remove(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
    attachmentId: string,
  ): Promise<{ deleted: true }> {
    const attachment = await this.requireAttachment(workspaceId, attachmentId, {
      includePending: true,
    });

    const isUploader = attachment.uploaderId === userId;
    if (!isUploader && !hasAtLeastRole(role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only the uploader or a workspace manager can delete an attachment.',
      );
    }

    await this.discard(attachment);

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.DETACHED,
      entity: attachment.taskId ? ActivityEntity.TASK : ActivityEntity.TICKET,
      entityId: (attachment.taskId ?? attachment.ticketId) as string,
      summary: `Removed "${attachment.filename}"`,
      metadata: {
        attachmentId,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        commentId: attachment.commentId,
      },
    });

    await this.announceParent(attachment);

    return { deleted: true };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Removes the bytes and the row together. */
  private async discard(attachment: PrismaAttachment): Promise<void> {
    await this.storage.deleteObject(attachment.objectKey);
    await this.prisma.attachment.delete({ where: { id: attachment.id } });
  }

  private async listFor(link: { taskId?: string; ticketId?: string }): Promise<Attachment[]> {
    const attachments = await this.prisma.attachment.findMany({
      // PENDING rows are invisible: an upload in flight is not yet a file, and
      // showing one would offer a download that cannot work.
      where: { ...link, status: AttachmentStatus.READY },
      include: attachmentInclude,
      orderBy: { createdAt: 'asc' },
    });

    return attachments.map(toAttachmentDto);
  }

  /**
   * Proves the parent belongs to this workspace before anything is written.
   *
   * `requireTask`/`requireTicket` are the same checks the rest of the app uses,
   * so an id from another workspace is a 404 here exactly as it is everywhere
   * else — the attachment cannot be used to discover what exists elsewhere.
   */
  private async resolveParent(
    workspaceId: string,
    dto: CreateAttachmentDto,
  ): Promise<AttachmentParent> {
    /*
     * Checked here rather than on the DTO because `@IsOptional()` skips every
     * validator on a field the moment it is absent — a class-validator rule
     * spanning both ids could never fire for a ticket-only payload, which is
     * exactly half the cases it exists for.
     *
     * Rejecting "both" matters as much as rejecting "neither": taking the task
     * and dropping the ticket would silently attach the file somewhere the
     * caller did not ask for.
     */
    if (dto.taskId && dto.ticketId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Attach to exactly one of a task or a ticket, not both.',
      );
    }

    if (dto.taskId) {
      const task = await this.tasks.requireTask(workspaceId, dto.taskId);
      return { link: { taskId: task.id, ticketId: null }, label: task.title };
    }

    if (dto.ticketId) {
      const ticket = await this.tickets.requireTicket(workspaceId, dto.ticketId);
      return { link: { taskId: null, ticketId: ticket.id }, label: ticket.key };
    }

    throw AppException.badRequest('BAD_REQUEST', 'Attach to exactly one of a task or a ticket.');
  }

  private async assertCapacity(workspaceId: string, parent: AttachmentParent): Promise<void> {
    const count = await this.prisma.attachment.count({
      where: {
        workspaceId,
        ...(parent.link.taskId ? { taskId: parent.link.taskId } : {}),
        ...(parent.link.ticketId ? { ticketId: parent.link.ticketId } : {}),
        status: AttachmentStatus.READY,
      },
    });

    if (count >= MAX_ATTACHMENTS_PER_ITEM) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `${parent.label} already has the maximum of ${MAX_ATTACHMENTS_PER_ITEM} attachments.`,
      );
    }
  }

  private async requireAttachment(
    workspaceId: string,
    attachmentId: string,
    options: { includePending?: boolean } = {},
  ): Promise<PrismaAttachment> {
    const attachment = await this.prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        workspaceId,
        ...(options.includePending ? {} : { status: AttachmentStatus.READY }),
      },
    });

    if (!attachment) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Attachment not found.');
    }

    return attachment;
  }

  private async read(attachmentId: string): Promise<Attachment> {
    const attachment = await this.prisma.attachment.findUniqueOrThrow({
      where: { id: attachmentId },
      include: attachmentInclude,
    });

    return toAttachmentDto(attachment);
  }
}
