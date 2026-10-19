import { randomBytes } from 'node:crypto';

import {
  INBOUND_EMAIL_RECENT,
  INBOUND_TOKEN_BYTES,
  InboundEmailOutcome,
  InboundEmailSender,
  WorkspaceRole,
  inboundAddress,
} from '@coretask/contracts';
import type { ProjectEmailSettings, UpdateProjectEmailPayload } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { ProjectEmailInbox } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

export const newInboundToken = () => randomBytes(INBOUND_TOKEN_BYTES).toString('hex');

/**
 * Customize › Emails: a project's address and how mail sent to it is handled.
 * The address exists from the first time an editor looks; resetting it gives
 * the project a new one and leaves every old address, reply addresses
 * included, answering nothing.
 */
@Injectable()
export class ProjectEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly config: AppConfigService,
  ) {}

  async get(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectEmailSettings> {
    await this.requireEditor(workspaceId, projectId, actor);
    return this.describe(await this.ensure(workspaceId, projectId, actor));
  }

  async update(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    payload: UpdateProjectEmailPayload,
  ): Promise<ProjectEmailSettings> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.ensure(workspaceId, projectId, actor);
    if (payload.sectionId) {
      const section = await this.prisma.section.findFirst({
        where: { id: payload.sectionId, projectId },
        select: { id: true },
      });
      if (!section) {
        throw AppException.badRequest('BAD_REQUEST', 'That section is not in this project.');
      }
    }
    const inbox = await this.prisma.projectEmailInbox.update({
      where: { projectId },
      data: {
        ...(payload.isActive !== undefined ? { isActive: payload.isActive } : {}),
        ...(payload.sectionId !== undefined ? { sectionId: payload.sectionId } : {}),
        ...(payload.acceptFrom !== undefined ? { acceptFrom: payload.acceptFrom } : {}),
        ...(payload.addCollaborators !== undefined
          ? { addCollaborators: payload.addCollaborators }
          : {}),
        ...(payload.sendUpdates !== undefined ? { sendUpdates: payload.sendUpdates } : {}),
      },
    });
    return this.describe(inbox);
  }

  async resetAddress(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectEmailSettings> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.ensure(workspaceId, projectId, actor);
    const inbox = await this.prisma.projectEmailInbox.update({
      where: { projectId },
      data: { token: newInboundToken() },
    });
    return this.describe(inbox);
  }

  // -------------------------------------------------------------------------

  private async ensure(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectEmailInbox> {
    const existing = await this.prisma.projectEmailInbox.findUnique({ where: { projectId } });
    if (existing) return existing;
    // Two first looks at once: the unique index refuses the second, which reads.
    return this.prisma.projectEmailInbox
      .create({
        data: { workspaceId, projectId, token: newInboundToken(), createdById: actor.userId },
      })
      .catch(() => this.prisma.projectEmailInbox.findUniqueOrThrow({ where: { projectId } }));
  }

  private async describe(inbox: ProjectEmailInbox): Promise<ProjectEmailSettings> {
    const { domain, enabled } = this.config.inboundEmail;
    const recent = await this.prisma.inboundEmail.findMany({
      where: { projectId: inbox.projectId },
      orderBy: { receivedAt: 'desc' },
      take: INBOUND_EMAIL_RECENT,
    });
    return {
      address: enabled && domain ? inboundAddress(inbox.token, domain) : null,
      receiving: enabled,
      isActive: inbox.isActive,
      sectionId: inbox.sectionId,
      acceptFrom:
        inbox.acceptFrom === InboundEmailSender.ANYONE
          ? InboundEmailSender.ANYONE
          : InboundEmailSender.MEMBERS,
      addCollaborators: inbox.addCollaborators,
      sendUpdates: inbox.sendUpdates,
      receivedCount: inbox.receivedCount,
      recent: recent.map((row) => ({
        id: row.id,
        fromAddress: row.fromAddress,
        subject: row.subject,
        outcome: row.outcome as InboundEmailOutcome,
        reason: row.reason,
        taskId: row.taskId,
        receivedAt: row.receivedAt.toISOString(),
      })),
    };
  }

  private async requireEditor(workspaceId: string, projectId: string, actor: ActorContext) {
    await this.access.requireAccess(workspaceId, projectId, actor, WorkspaceRole.MEMBER);
  }
}
