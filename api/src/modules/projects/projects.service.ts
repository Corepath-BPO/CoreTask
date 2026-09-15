import {
  ActivityAction,
  ActivityEntity,
  DEFAULT_SECTION_NAMES,
  PROJECT_KEY_MAX_LENGTH,
  PROJECT_MEMBER_PREVIEW_LIMIT,
  ProjectMemberRole,
  ProjectStatus,
  ProjectVisibility,
  ServerEvent,
  TaskStatus,
  canManageProject,
  effectiveWorkspaceRole,
} from '@coretask/contracts';
import type { ProjectAccess, ProjectDetail, ProjectSummary } from '@coretask/types';
import { deriveProjectKey } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Project } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PaginatedResult, type ActorContext } from '../../common/types/api.types';
import { buildPaginationMeta, toSkipTake } from '../../common/utils/pagination.util';
import { initialPositions } from '../../common/utils/position.util';
import { PrismaService } from '../../database/prisma.service';
import { ProjectBroadcastService } from '../../websocket/project-broadcast.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectAccessService } from '../project-access/project-access.service';
import { toSectionDto, type SectionWithCount } from '../sections/section.mapper';

import type { CreateProjectDto, ProjectListQueryDto, UpdateProjectDto } from './dto/project.dto';

const LEAD_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;
const MEMBER_USER_SELECT = { ...LEAD_SELECT, isServiceAccount: true } as const;

const PROJECT_INCLUDE = {
  lead: { select: LEAD_SELECT },
  team: { select: { id: true, name: true, color: true } },
  // Admins first, then by seniority — the order an avatar stack shows them.
  // Enum ordering follows the declaration (ADMIN, EDITOR, VIEWER).
  members: {
    take: PROJECT_MEMBER_PREVIEW_LIMIT,
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    include: { user: { select: MEMBER_USER_SELECT } },
  },
  _count: { select: { sections: true, tasks: true, members: true } },
} satisfies Prisma.ProjectInclude;

type ProjectWithCounts = Prisma.ProjectGetPayload<{ include: typeof PROJECT_INCLUDE }>;

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogsService,
    private readonly access: ProjectAccessService,
    private readonly broadcast: ProjectBroadcastService,
  ) {}

  async list(
    workspaceId: string,
    actor: ActorContext,
    query: ProjectListQueryDto,
  ): Promise<PaginatedResult<ProjectSummary>> {
    const where: Prisma.ProjectWhereInput = {
      workspaceId,
      // Under AND because the search filter below owns the top-level OR.
      AND: [this.access.projectWhere(actor)],
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

    const ids = projects.map((project) => project.id);
    const [completed, memberships] = await Promise.all([
      this.completedTaskCounts(ids),
      this.membershipsFor(actor.userId, ids),
    ]);

    return new PaginatedResult(
      projects.map((project) =>
        this.toSummary(
          project,
          completed.get(project.id) ?? 0,
          this.accessFor(actor, memberships.get(project.id) ?? null),
        ),
      ),
      buildPaginationMeta(query, total),
    );
  }

  /** The board payload: a project plus its ordered columns. */
  async getDetail(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectDetail> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId, AND: [this.access.projectWhere(actor)] },
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

    const [completed, memberships] = await Promise.all([
      this.completedTaskCounts([projectId]),
      this.membershipsFor(actor.userId, [projectId]),
    ]);

    return {
      ...this.toSummary(
        project,
        completed.get(projectId) ?? 0,
        this.accessFor(actor, memberships.get(projectId) ?? null),
      ),
      sections: project.sections.map((section) => toSectionDto(section as SectionWithCount)),
    };
  }

  async create(
    workspaceId: string,
    actor: ActorContext,
    dto: CreateProjectDto,
  ): Promise<ProjectDetail> {
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
          ...(dto.defaultWorkItemType ? { defaultWorkItemType: dto.defaultWorkItemType } : {}),
          visibility: dto.visibility ?? ProjectVisibility.PUBLIC,
          leadId: dto.leadId ?? null,
          teamId: dto.teamId ?? null,
          startDate: toDate(dto.startDate),
          dueDate: toDate(dto.dueDate),
        },
      });

      // Whoever creates a project runs it, and so does the lead they named.
      // Both are admins from the first moment, so a private project is never
      // born without one.
      await tx.projectMember.createMany({
        data: uniqueIds([actor.userId, dto.leadId]).map((userId) => ({
          projectId: created.id,
          workspaceId,
          userId,
          role: ProjectMemberRole.ADMIN,
          addedById: userId === actor.userId ? null : actor.userId,
        })),
        skipDuplicates: true,
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
      actorId: actor.userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.PROJECT,
      entityId: project.id,
      projectId: project.id,
      summary: `Created project "${project.name}"`,
      metadata: { key: project.key, visibility: project.visibility },
    });

    const detail = await this.getDetail(workspaceId, project.id, actor);
    void this.broadcast.emit(
      workspaceId,
      project.id,
      ServerEvent.PROJECT_CREATED,
      withoutAccess(detail),
    );
    this.logger.log({ projectId: project.id, workspaceId }, 'Project created');

    return detail;
  }

  async update(
    workspaceId: string,
    actor: ActorContext,
    projectId: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectSummary> {
    const access = await this.access.resolveAccess(workspaceId, projectId, actor);
    const existing = access.project;
    await this.assertLeadIsMember(workspaceId, dto.leadId);
    await this.assertTeamInWorkspace(workspaceId, dto.teamId);

    const data: Prisma.ProjectUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.defaultWorkItemType !== undefined) {
      data.defaultWorkItemType = dto.defaultWorkItemType;
    }
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

    // Who can see the project is a decision for the people who run it, not
    // for anyone who may edit its name.
    const visibilityChange =
      dto.visibility !== undefined && dto.visibility !== existing.visibility
        ? dto.visibility
        : null;
    if (visibilityChange !== null) {
      if (!access.canManage) {
        throw AppException.forbidden(
          'INSUFFICIENT_PROJECT_ROLE',
          'Only a project admin can change who can see this project.',
        );
      }
      data.visibility = visibilityChange;
    }

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.project.update({ where: { id: projectId }, data });

      // A named lead runs the project. An existing member keeps whatever role
      // they had — being made lead never demotes anyone.
      if (dto.leadId) {
        await this.ensureMember(tx, workspaceId, projectId, dto.leadId, actor.userId);
      }

      // Going private must never lock out the person doing it, and a private
      // project must always have an admin — so the actor becomes one now if
      // nobody else is.
      if (visibilityChange === ProjectVisibility.PRIVATE) {
        await this.ensureMember(tx, workspaceId, projectId, actor.userId, null);
        const admins = await tx.projectMember.count({
          where: { projectId, role: ProjectMemberRole.ADMIN },
        });
        if (admins === 0) {
          await tx.projectMember.update({
            where: { projectId_userId: { projectId, userId: actor.userId } },
            data: { role: ProjectMemberRole.ADMIN },
          });
        }
      }
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      projectId,
      summary: `Updated project "${dto.name ?? existing.name}"`,
      metadata: {
        fields: Object.keys(data),
        ...(visibilityChange ? { visibility: visibilityChange } : {}),
      },
    });

    const summary = await this.getSummary(workspaceId, projectId, actor);
    void this.broadcast.emit(
      workspaceId,
      projectId,
      ServerEvent.PROJECT_UPDATED,
      withoutAccess(summary),
    );

    // Everyone the project just disappeared for needs to hear it: their open
    // tabs are still in its room and their lists still show it.
    if (visibilityChange === ProjectVisibility.PRIVATE) {
      await this.revokeFromOutsiders(workspaceId, projectId);
    }

    return summary;
  }

  /**
   * Archive rather than delete: tasks, tickets and activity keep referring to
   * the project, and archiving is a reversible product action.
   */
  async archive(
    workspaceId: string,
    actor: ActorContext,
    projectId: string,
  ): Promise<ProjectSummary> {
    const { project: existing } = await this.access.resolveAccess(workspaceId, projectId, actor);

    if (existing.archivedAt !== null) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This project is already archived.');
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date(), status: ProjectStatus.ARCHIVED },
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.ARCHIVED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      projectId,
      summary: `Archived project "${existing.name}"`,
    });

    const summary = await this.getSummary(workspaceId, projectId, actor);
    void this.broadcast.emit(
      workspaceId,
      projectId,
      ServerEvent.PROJECT_ARCHIVED,
      withoutAccess(summary),
    );

    return summary;
  }

  async restore(
    workspaceId: string,
    actor: ActorContext,
    projectId: string,
  ): Promise<ProjectSummary> {
    const { project: existing } = await this.access.resolveAccess(workspaceId, projectId, actor);

    if (existing.archivedAt === null) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This project is not archived.');
    }

    await this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: null, status: ProjectStatus.ACTIVE },
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.RESTORED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      projectId,
      summary: `Restored project "${existing.name}"`,
    });

    const summary = await this.getSummary(workspaceId, projectId, actor);
    void this.broadcast.emit(
      workspaceId,
      projectId,
      ServerEvent.PROJECT_RESTORED,
      withoutAccess(summary),
    );

    return summary;
  }

  /**
   * Loads a project *within a workspace*, tenancy only.
   *
   * The `workspaceId` in the filter is what stops an id from another tenant
   * resolving; the membership check has already happened in the guard, so a
   * foreign id must look like it does not exist. Visibility is *not* checked
   * here — routes under a project have `ProjectAccessGuard` for that, and a
   * `projectId` arriving in a body goes through `ProjectAccessService`.
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

  /** A summary as `actor` sees it, for the members module after a roster change. */
  async getSummary(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectSummary> {
    const project = await this.prisma.project.findFirstOrThrow({
      where: { id: projectId, workspaceId },
      include: PROJECT_INCLUDE,
    });

    const [completed, memberships] = await Promise.all([
      this.completedTaskCounts([projectId]),
      this.membershipsFor(actor.userId, [projectId]),
    ]);

    return this.toSummary(
      project,
      completed.get(projectId) ?? 0,
      this.accessFor(actor, memberships.get(projectId) ?? null),
    );
  }

  /** Adds someone as an admin unless they are already on the roster, whatever their role. */
  private async ensureMember(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    projectId: string,
    userId: string,
    addedById: string | null,
  ): Promise<void> {
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, workspaceId, userId, role: ProjectMemberRole.ADMIN, addedById },
      update: {},
    });
  }

  /** Every workspace member who is not in the project's audience loses it. */
  private async revokeFromOutsiders(workspaceId: string, projectId: string): Promise<void> {
    const [audience, members] = await Promise.all([
      this.access.audienceUserIds(workspaceId, projectId),
      this.prisma.workspaceMember.findMany({ where: { workspaceId }, select: { userId: true } }),
    ]);
    const allowed = new Set(audience);
    const outsiders = members.map((row) => row.userId).filter((userId) => !allowed.has(userId));

    await this.broadcast.revoke(workspaceId, projectId, outsiders);
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

  /**
   * The reader's own role in each project on the page, in one query. The
   * preview on the include is capped and admins-first, so it cannot be relied
   * on to contain the reader.
   */
  private async membershipsFor(
    userId: string,
    projectIds: string[],
  ): Promise<Map<string, ProjectMemberRole>> {
    if (projectIds.length === 0) return new Map();

    const rows = await this.prisma.projectMember.findMany({
      where: { userId, projectId: { in: projectIds } },
      select: { projectId: true, role: true },
    });

    return new Map(rows.map((row) => [row.projectId, row.role]));
  }

  private accessFor(actor: ActorContext, projectRole: ProjectMemberRole | null): ProjectAccess {
    return {
      effectiveRole: effectiveWorkspaceRole(actor.role, projectRole),
      projectRole,
      isMember: projectRole !== null,
      canManage: canManageProject(actor.role, projectRole),
    };
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

  private toSummary(
    project: ProjectWithCounts,
    completedTaskCount: number,
    access: ProjectAccess,
  ): ProjectSummary {
    return {
      id: project.id,
      workspaceId: project.workspaceId,
      name: project.name,
      key: project.key,
      description: project.description,
      status: project.status,
      color: project.color,
      defaultWorkItemType: project.defaultWorkItemType,
      visibility: project.visibility,
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
      memberCount: project._count.members,
      members: project.members.map((member) => ({ user: member.user, role: member.role })),
      access,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

/** `access` is one reader's view; a broadcast reaches many, so it goes without. */
function withoutAccess<T extends { access: ProjectAccess }>(summary: T): Omit<T, 'access'> {
  const { access: _access, ...rest } = summary;
  return rest;
}
