import { MAX_STATUS_TEMPLATES_PER_PROJECT, WorkspaceRole } from '@coretask/contracts';
import type { StatusTemplate, StatusTemplateDraft } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { StatusTemplate as TemplateRow } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

function toDto(row: TemplateRow): StatusTemplate {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    status: row.status,
    summary: row.summary,
    nextSteps: row.nextSteps,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Blank text is no text: an empty section should leave the composer's empty. */
const text = (value: string | null | undefined) => value?.trim() || null;

/**
 * Status templates — Customize › Status templates.
 *
 * A template is where a status update starts: the status to begin on and the
 * Summary and Next steps a team writes the same way every week. Using one only
 * fills the composer; nothing is posted until its author says so.
 *
 * Anyone who can see the project may read them, since anyone who can post a
 * status may use one; changing them is for whoever can edit the project.
 */
@Injectable()
export class StatusTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<StatusTemplate[]> {
    await this.requireVisible(workspaceId, projectId, actor);
    const rows = await this.prisma.statusTemplate.findMany({
      where: { projectId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    draft: StatusTemplateDraft,
  ): Promise<StatusTemplate> {
    await this.requireEditor(workspaceId, projectId, actor);

    const count = await this.prisma.statusTemplate.count({ where: { projectId } });
    if (count >= MAX_STATUS_TEMPLATES_PER_PROJECT) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A project holds up to ${MAX_STATUS_TEMPLATES_PER_PROJECT} status templates.`,
      );
    }

    const row = await this.prisma.statusTemplate.create({
      data: {
        workspaceId,
        projectId,
        createdById: actor.userId,
        name: draft.name.trim(),
        status: draft.status ?? null,
        summary: text(draft.summary),
        nextSteps: text(draft.nextSteps),
      },
    });
    return toDto(row);
  }

  async update(
    workspaceId: string,
    projectId: string,
    templateId: string,
    actor: ActorContext,
    draft: Partial<StatusTemplateDraft>,
  ): Promise<StatusTemplate> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.require(projectId, templateId);

    const row = await this.prisma.statusTemplate.update({
      where: { id: templateId },
      data: {
        ...(draft.name !== undefined ? { name: draft.name.trim() } : {}),
        ...(draft.status !== undefined ? { status: draft.status } : {}),
        ...(draft.summary !== undefined ? { summary: text(draft.summary) } : {}),
        ...(draft.nextSteps !== undefined ? { nextSteps: text(draft.nextSteps) } : {}),
      },
    });
    return toDto(row);
  }

  async remove(
    workspaceId: string,
    projectId: string,
    templateId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.require(projectId, templateId);
    await this.prisma.statusTemplate.delete({ where: { id: templateId } });
  }

  private async require(projectId: string, templateId: string): Promise<TemplateRow> {
    const row = await this.prisma.statusTemplate.findFirst({
      where: { id: templateId, projectId },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Status template not found.');
    return row;
  }

  private async requireVisible(workspaceId: string, projectId: string, actor: ActorContext) {
    const access = await this.access.findAccess(workspaceId, projectId, actor);
    if (!access) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
  }

  private async requireEditor(workspaceId: string, projectId: string, actor: ActorContext) {
    await this.requireVisible(workspaceId, projectId, actor);
    await this.access.assertEffectiveRole(projectId, actor, WorkspaceRole.MEMBER);
  }
}
