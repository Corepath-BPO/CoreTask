import {
  ActivityAction,
  ActivityEntity,
  DEFAULT_SECTION_NAMES,
  PROJECT_KEY_MAX_LENGTH,
  ProjectStatus,
  ServerEvent,
  TaskStatus,
} from '@coretask/contracts';
import type { ProjectDetail, ProjectSummary } from '@coretask/types';
import { deriveProjectKey } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Project } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult } from '../../common/types/api.types';
import { buildPaginationMeta, toSkipTake } from '../../common/utils/pagination.util';
import { initialPositions } from '../../common/utils/position.util';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { toSectionDto, type SectionWithCount } from '../sections/section.mapper';
import { RealtimeGateway } from '../../websocket/realtime.gateway';

import type { CreateProjectDto, ProjectListQueryDto, UpdateProjectDto } from './dto/project.dto';

const LEAD_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

const PROJECT_INCLUDE = {
  lead: { select: LEAD_SELECT },
  team: { select: { id: true, name: true, color: true } },
  _count: { select: { sections: true, tasks: true } },
} satisfies Prisma.ProjectInclude;

type ProjectWithCounts = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(
    workspaceId: string,
    query: ProjectListQueryDto,
  ): Promise<PaginatedResult<ProjectSummary>> {
    const where: Prisma.ProjectWhereInput = {
      workspaceId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.teamId ? { teamId: query.teamId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { key: { contains: query.search.toUpperCase() } },
            ],
          }
        : {}),
    };

    const [total, projects] = await this.prisma.$transaction([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        include: PROJECT_INCLUDE,
        // Active projects first, then alphabetical — the order people scan in.
        orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
        ...toSkipTake(query),
      }),
    ]);

    const completed = await this.completedTaskCounts(projects.map((project) => project.id));

    return new PaginatedResult(
      projects.map((project) => this.toSummary(project, completed.get(project.id) ?? 0)),
      buildPaginationMeta(query, total),
    );
  }

  /** The board payload: a project plus its ordered columns. */
  async getDetail(workspaceId: string, projectId: string): Promise<ProjectDetail> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      include: {
        ...PROJECT_INCLUDE,
        sections: {
          orderBy: { position: 'asc' },
          include: { _count: { select: { tasks: true } } },
        },
      },
    });

    if (!project) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
    }

    const completed = await this.completedTaskCounts([projectId]);

    return {
      ...this.toSummary(project, completed.get(projectId) ?? 0),
      sections: project.sections.map((section) => toSectionDto(section as SectionWithCount)),
    };
  }

  async create(workspaceId: string, userId: string, dto: CreateProjectDto): Promise<ProjectDetail> {
    await this.assertLeadIsMember(workspaceId, dto.leadId);
    await this.assertTeamInWorkspace(workspaceId, dto.teamId);

    const key = await this.resolveKey(workspaceId, dto.key ?? deriveProjectKey(dto.name));

    const project = await this.prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          workspaceId,
          name: dto.name,
          key,
          description: dto.description ?? null,
          status: dto.status ?? ProjectStatus.PLANNING,
          ...(dto.color ? { color: dto.color } : {}),
          leadId: dto.leadId ?? null,
          teamId: dto.teamId ?? null,
          startDate: toDate(dto.startDate),
          dueDate: toDate(dto.dueDate),
        },
      });

      // A project with no columns cannot show a board, so the defaults are part
      // of creation rather than something the user has to set up first.
      const positions = initialPositions(DEFAULT_SECTION_NAMES.length);
      await tx.section.createMany({
        data: DEFAULT_SECTION_NAMES.map((name, index) => ({
          workspaceId,
          projectId: created.id,
          name,
          position: positions[index] as number,
        })),
      });

      return created;
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.PROJECT,
      entityId: project.id,
      summary: `Created project "${project.name}"`,
      metadata: { key: project.key },
    });

    const detail = await this.getDetail(workspaceId, project.id);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.PROJECT_CREATED, detail);
    this.logger.log({ projectId: project.id, workspaceId }, 'Project created');

    return detail;
  }

  async update(
    workspaceId: string,
    userId: string,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectSummary> {
    const existing = await this.requireProject(workspaceId, projectId);
    await this.assertLeadIsMember(workspaceId, dto.leadId);
    await this.assertTeamInWorkspace(workspaceId, dto.teamId);

    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.startDate !== undefined) data.startDate = toDate(dto.startDate);
    if (dto.dueDate !== undefined) data.dueDate = toDate(dto.dueDate);
    if (dto.leadId !== undefined) {
      data.lead = dto.leadId ? { connect: { id: dto.leadId } } : { disconnect: true };
    }
    if (dto.teamId !== undefined) {
      data.team = dto.teamId ? { connect: { id: dto.teamId } } : { disconnect: true };
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
      // COMPLETED is the one status that carries a timestamp; keep the two from
      // drifting rather than letting callers set them independently.
      if (dto.status === ProjectStatus.COMPLETED && existing.completedAt === null) {
        data.completedAt = new Date();
      } else if (dto.status !== ProjectStatus.COMPLETED && existing.completedAt !== null) {
        data.completedAt = null;
      }
    }

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    await this.prisma.project.update({ where: { id: projectId }, data });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      summary: `Updated project "${dto.name ?? existing.name}"`,
      metadata: { fields: Object.keys(data) },
    });

    const summary = await this.getSummary(workspaceId, projectId);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.PROJECT_UPDATED, summary);

    return summary;
  }

  /**
   * Archive rather than delete: tasks, tickets and activity keep referring to
   * the project, and archiving is a reversible product action.
   */
  async archive(workspaceId: string, userId: string, projectId: string): Promise<ProjectSummary> {
    const existing = await this.requireProject(workspaceId, projectId);

    if (existing.archivedAt !== null) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This project is already archived.');
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date(), status: ProjectStatus.ARCHIVED },
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.ARCHIVED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      summary: `Archived project "${existing.name}"`,
    });

    const summary = await this.getSummary(workspaceId, projectId);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.PROJECT_ARCHIVED, summary);

    return summary;
  }

  async restore(workspaceId: string, userId: string, projectId: string): Promise<ProjectSummary> {
    const existing = await this.requireProject(workspaceId, projectId);

    if (existing.archivedAt === null) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This project is not archived.');
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: null, status: ProjectStatus.ACTIVE },
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.RESTORED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      summary: `Restored project "${existing.name}"`,
    });

    const summary = await this.getSummary(workspaceId, projectId);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.PROJECT_RESTORED, summary);

    return summary;
  }

  /**
   * Loads a project *within a workspace*.
   *
   * The `workspaceId` in the filter is what stops an id from another tenant
   * resolving; the membership check has already happened in the guard, so a
   * foreign id must look like it does not exist.
   */
  async requireProject(workspaceId: string, projectId: string): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
    });

    if (!project) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
    }

    return project;
  }

  private async getSummary(workspaceId: string, projectId: string): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirstOrThrow({
      where: { id: projectId, workspaceId },
      include: PROJECT_INCLUDE,
    });

    const completed = await this.completedTaskCounts([projectId]);
    return this.toSummary(project, completed.get(projectId) ?? 0);
  }

  /**
   * One grouped query for the whole page rather than a count per project —
   * Prisma cannot express two differently-filtered counts on the same relation.
   */
  private async completedTaskCounts(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();

    const rows = await this.prisma.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, status: TaskStatus.DONE },
      _count: { _all: true },
    });

    return new Map(
      rows
        .filter((row): row is typeof row & { projectId: string } => row.projectId !== null)
        .map((row) => [row.projectId, row._count._all]),
    );
  }

  /** A lead must already belong to the workspace, or membership means nothing. */
  private async assertLeadIsMember(
    workspaceId: string,
    leadId: string | null | undefined,
  ): Promise<void> {
    if (!leadId) return;

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: leadId } },
      select: { id: true },
    });

    if (!membership) {
      throw AppException.badRequest('BAD_REQUEST', 'The project lead must be a workspace member.');
    }
  }

  /**
   * The team must live in this workspace.
   *
   * `teamId` arrives from the client, and the foreign key alone would happily
   * accept a valid team id belonging to somebody else's workspace — which would
   * leak its name and colour into this one through the project badge.
   */
  private async assertTeamInWorkspace(
    workspaceId: string,
    teamId: string | null | undefined,
  ): Promise<void> {
    if (!teamId) return;

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, workspaceId },
      select: { id: true },
    });

    if (!team) {
      throw AppException.badRequest('BAD_REQUEST', 'That team does not belong to this workspace.');
    }
  }

  /** Appends `2`, `3`, … until the key is free inside this workspace. */
  private async resolveKey(workspaceId: string, base: string): Promise<string> {
    const normalized = base.toUpperCase().slice(0, PROJECT_KEY_MAX_LENGTH);

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? '' : String(attempt + 1);
      const candidate = `${normalized.slice(0, PROJECT_KEY_MAX_LENGTH - suffix.length)}${suffix}`;

      const taken = await this.prisma.project.findUnique({
        where: { workspaceId_key: { workspaceId, key: candidate } },
        select: { id: true },
      });

      if (!taken) return candidate;
    }

    throw AppException.conflict('PROJECT_KEY_TAKEN');
  }

  private toSummary(project: ProjectWithCounts, completedTaskCount: number): ProjectSummary {
    return {
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      key: project.key,
      description: project.description,
      status: project.status,
      color: project.color,
      leadId: project.leadId,
      lead: project.lead,
      teamId: project.teamId,
      team: project.team,
      startDate: project.startDate?.toISOString() ?? null,
      dueDate: project.dueDate?.toISOString() ?? null,
      completedAt: project.completedAt?.toISOString() ?? null,
      archivedAt: project.archivedAt?.toISOString() ?? null,
      taskCount: project._count.tasks,
      completedTaskCount,
      sectionCount: project._count.sections,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}
