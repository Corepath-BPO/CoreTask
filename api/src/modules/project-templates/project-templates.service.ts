import {
  DEFAULT_DUPLICATE_PARTS,
  DEFAULT_TEMPLATE_PARTS,
  MAX_PROJECT_TEMPLATES,
  WorkspaceRole,
  hasAtLeastRole,
  readBlueprintParts,
} from '@coretask/contracts';
import type {
  CreateProjectTemplatePayload,
  DuplicateProjectPayload,
  ProjectTemplate,
  StartProjectPayload,
  StartedProject,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { ActivityAction, ActivityEntity, type Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import { ProjectBlueprintService, type Blueprint } from './project-blueprint.service';

const templateInclude = {
  createdBy: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.ProjectTemplateInclude;

type TemplateRow = Prisma.ProjectTemplateGetPayload<{ include: typeof templateInclude }>;

const countTasks = (blueprint: Blueprint) =>
  blueprint.tasks.reduce((sum, task) => sum + 1 + task.subtasks.length, 0);

function toDto(row: TemplateRow): ProjectTemplate {
  const blueprint = row.blueprint as unknown as Blueprint;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    color: row.color,
    parts: readBlueprintParts(row.parts),
    sectionCount: blueprint.sections?.length ?? 0,
    taskCount: blueprint.tasks ? countTasks(blueprint) : 0,
    ruleCount: blueprint.rules?.length ?? 0,
    fieldCount: blueprint.fieldIds?.length ?? 0,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Today, or the day named, as a Date at UTC midnight. */
function startOf(day: string | null | undefined): Date {
  if (day) return new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Project templates and "Duplicate project".
 *
 * Templates are the workspace's: everyone can start a project from one, any
 * member can save one from a project they can see, and its creator or a
 * manager may rename or delete it. Duplicating needs only to see the project;
 * the copy is the duplicator's, who runs it.
 */
@Injectable()
export class ProjectTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly activity: ActivityLogsService,
    private readonly blueprints: ProjectBlueprintService,
  ) {}

  async list(workspaceId: string): Promise<ProjectTemplate[]> {
    const rows = await this.prisma.projectTemplate.findMany({
      where: { workspaceId },
      include: templateInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(
    workspaceId: string,
    actor: ActorContext,
    payload: CreateProjectTemplatePayload,
  ): Promise<ProjectTemplate> {
    this.assertMember(actor);
    await this.access.requireAccess(workspaceId, payload.projectId, actor);
    if (
      (await this.prisma.projectTemplate.count({ where: { workspaceId } })) >= MAX_PROJECT_TEMPLATES
    ) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A workspace holds up to ${MAX_PROJECT_TEMPLATES} project templates.`,
      );
    }

    const parts = payload.parts?.length
      ? readBlueprintParts(payload.parts)
      : [...DEFAULT_TEMPLATE_PARTS];
    const blueprint = await this.blueprints.take(workspaceId, payload.projectId, parts);

    const row = await this.prisma.projectTemplate.create({
      data: {
        workspaceId,
        name: payload.name.trim(),
        description: payload.description?.trim() || blueprint.description,
        color: blueprint.color,
        parts,
        blueprint: blueprint as unknown as Prisma.InputJsonValue,
        sourceProjectId: payload.projectId,
        createdById: actor.userId,
      },
      include: templateInclude,
    });
    return toDto(row);
  }

  async update(
    workspaceId: string,
    templateId: string,
    actor: ActorContext,
    payload: { name?: string; description?: string | null },
  ): Promise<ProjectTemplate> {
    await this.requireMayChange(workspaceId, templateId, actor);
    const row = await this.prisma.projectTemplate.update({
      where: { id: templateId },
      data: {
        ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
        ...(payload.description !== undefined
          ? { description: payload.description?.trim() || null }
          : {}),
      },
      include: templateInclude,
    });
    return toDto(row);
  }

  async remove(workspaceId: string, templateId: string, actor: ActorContext): Promise<void> {
    await this.requireMayChange(workspaceId, templateId, actor);
    await this.prisma.projectTemplate.delete({ where: { id: templateId } });
  }

  /** A new project from the template, its task dates counted from its start. */
  async use(
    workspaceId: string,
    templateId: string,
    actor: ActorContext,
    payload: StartProjectPayload,
  ): Promise<StartedProject> {
    this.assertMember(actor);
    const template = await this.prisma.projectTemplate.findFirst({
      where: { id: templateId, workspaceId },
    });
    if (!template) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Template not found.');

    const started = await this.blueprints.start(
      workspaceId,
      actor,
      template.blueprint as unknown as Blueprint,
      {
        name: payload.name.trim(),
        startDate: startOf(payload.startDate),
        ...(payload.visibility ? { visibility: payload.visibility } : {}),
        ...(payload.teamId ? { teamId: payload.teamId } : {}),
        keepProgress: false,
      },
    );

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.PROJECT,
      entityId: started.projectId,
      projectId: started.projectId,
      summary: `Started this project from the template “${template.name}”`,
      metadata: { templateId },
    });
    return started;
  }

  /** A copy of the project, with the parts chosen, run by whoever made it. */
  async duplicate(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    payload: DuplicateProjectPayload,
  ): Promise<StartedProject> {
    this.assertMember(actor);
    const access = await this.access.requireAccess(workspaceId, projectId, actor);

    const parts = payload.parts ? readBlueprintParts(payload.parts) : [...DEFAULT_DUPLICATE_PARTS];
    const blueprint = await this.blueprints.take(workspaceId, projectId, parts);
    const source = access.project;

    const started = await this.blueprints.start(workspaceId, actor, blueprint, {
      name: payload.name.trim(),
      // A copy keeps the original's calendar unless told otherwise.
      startDate: payload.startDate
        ? startOf(payload.startDate)
        : source.startDate
          ? startOf(source.startDate.toISOString())
          : startOf(null),
      visibility: payload.visibility ?? source.visibility,
      teamId: payload.teamId === undefined ? source.teamId : payload.teamId,
      keepProgress: true,
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.PROJECT,
      entityId: started.projectId,
      projectId: started.projectId,
      summary: `Duplicated this project from “${source.name}”`,
      metadata: { sourceProjectId: projectId, parts },
    });
    return started;
  }

  // -------------------------------------------------------------------------

  private assertMember(actor: ActorContext) {
    if (!hasAtLeastRole(actor.role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'Guests cannot start projects.');
    }
  }

  private async requireMayChange(workspaceId: string, templateId: string, actor: ActorContext) {
    const row = await this.prisma.projectTemplate.findFirst({
      where: { id: templateId, workspaceId },
      select: { createdById: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Template not found.');
    if (row.createdById !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only the template’s creator or a manager can change it.',
      );
    }
  }
}
