import { GoalProgressSource, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { Goal, GoalProjectRef } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { projectTaskCounts } from '../tasks/task-projects';
import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import type { CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';
import { rollUpProgress, wouldCreateCycle } from './goal-progress';

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

const GOAL_INCLUDE = {
  owner: { select: USER_SELECT },
  team: { select: { id: true, name: true, color: true } },
  projects: { select: { projectId: true } },
} satisfies Prisma.GoalInclude;

type GoalRow = Prisma.GoalGetPayload<{ include: typeof GOAL_INCLUDE }>;

/**
 * Workspace goals — Asana's Strategy › Goals.
 *
 * Goals are open to every member of the workspace, as Asana's are by default.
 * What they point at is not: a connected project in a private project the
 * reader is not on is left out of the goal they read, and does not count
 * towards the progress they are shown.
 */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(workspaceId: string, actor: ActorContext): Promise<Goal[]> {
    const rows = await this.prisma.goal.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: GOAL_INCLUDE,
    });
    return this.present(workspaceId, actor, rows);
  }

  async create(workspaceId: string, actor: ActorContext, dto: CreateGoalDto): Promise<Goal> {
    await this.assertReferences(workspaceId, dto);
    if (dto.parentId) await this.requireGoal(workspaceId, dto.parentId);

    const last = await this.prisma.goal.findFirst({
      where: { workspaceId, parentId: dto.parentId ?? null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const created = await this.prisma.goal.create({
      select: { id: true },
      data: {
        workspaceId,
        name: dto.name,
        description: dto.description ?? null,
        parentId: dto.parentId ?? null,
        ownerId: dto.ownerId === undefined ? actor.userId : dto.ownerId,
        teamId: dto.teamId ?? null,
        timePeriod: dto.timePeriod || null,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        ...(dto.status ? { status: dto.status } : {}),
        // A goal under another one rolls up its own sub-goals by default only
        // when asked; a new goal starts manual, as Asana's do.
        progressSource: dto.progressSource ?? GoalProgressSource.MANUAL,
        progress: dto.progress ?? 0,
        metricStart: dto.metricStart ?? null,
        metricCurrent: dto.metricCurrent ?? null,
        metricTarget: dto.metricTarget ?? null,
        metricUnit: dto.metricUnit?.trim() || null,
        position: (last?.position ?? 0) + 1024,
        createdById: actor.userId,
      },
    });

    return this.get(workspaceId, actor, created.id);
  }

  async update(
    workspaceId: string,
    actor: ActorContext,
    goalId: string,
    dto: UpdateGoalDto,
  ): Promise<Goal> {
    await this.requireGoal(workspaceId, goalId);
    await this.assertReferences(workspaceId, dto);

    if (dto.parentId) {
      await this.requireGoal(workspaceId, dto.parentId);
      const tree = await this.prisma.goal.findMany({
        where: { workspaceId },
        select: { id: true, parentId: true },
      });
      const parentOf = new Map(tree.map((goal) => [goal.id, goal.parentId]));
      if (wouldCreateCycle(goalId, dto.parentId, parentOf)) {
        throw AppException.badRequest(
          'BAD_REQUEST',
          'A goal cannot sit under itself or under one of its own sub-goals.',
        );
      }
    }

    const data: Prisma.GoalUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.parentId !== undefined) data.parentId = dto.parentId;
    if (dto.ownerId !== undefined) data.ownerId = dto.ownerId;
    if (dto.teamId !== undefined) data.teamId = dto.teamId;
    if (dto.timePeriod !== undefined) data.timePeriod = dto.timePeriod || null;
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.progressSource !== undefined) data.progressSource = dto.progressSource;
    if (dto.progress !== undefined) data.progress = dto.progress;
    if (dto.metricStart !== undefined) data.metricStart = dto.metricStart;
    if (dto.metricCurrent !== undefined) data.metricCurrent = dto.metricCurrent;
    if (dto.metricTarget !== undefined) data.metricTarget = dto.metricTarget;
    if (dto.metricUnit !== undefined) data.metricUnit = dto.metricUnit?.trim() || null;

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    await this.prisma.goal.update({ where: { id: goalId }, data });
    return this.get(workspaceId, actor, goalId);
  }

  /**
   * Archives a goal. Its sub-goals move up to its parent rather than going
   * with it — losing a grouping must never take the goals inside it along.
   * Open to managers, and to whoever owns or created the goal.
   */
  async archive(workspaceId: string, actor: ActorContext, goalId: string): Promise<void> {
    const goal = await this.requireGoal(workspaceId, goalId);
    const mayArchive =
      hasAtLeastRole(actor.role, WorkspaceRole.MANAGER) ||
      goal.ownerId === actor.userId ||
      goal.createdById === actor.userId;

    if (!mayArchive) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only the goal’s owner, its creator or a manager can delete it.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.goal.updateMany({
        where: { workspaceId, parentId: goalId },
        data: { parentId: goal.parentId },
      }),
      this.prisma.goal.update({
        where: { id: goalId },
        data: { archivedAt: new Date(), parentId: null },
      }),
    ]);
  }

  async linkProject(
    workspaceId: string,
    actor: ActorContext,
    goalId: string,
    projectId: string,
  ): Promise<Goal> {
    await this.requireGoal(workspaceId, goalId);
    // Connecting a project needs only to be able to see it.
    const access = await this.access.findAccess(workspaceId, projectId, actor);
    if (!access) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');

    await this.prisma.goalProject.upsert({
      where: { goalId_projectId: { goalId, projectId } },
      create: { goalId, projectId },
      update: {},
    });
    return this.get(workspaceId, actor, goalId);
  }

  async unlinkProject(
    workspaceId: string,
    actor: ActorContext,
    goalId: string,
    projectId: string,
  ): Promise<Goal> {
    await this.requireGoal(workspaceId, goalId);
    await this.prisma.goalProject.deleteMany({ where: { goalId, projectId } });
    return this.get(workspaceId, actor, goalId);
  }

  /** One goal as the list shows it, rolled-up progress and all. */
  async get(workspaceId: string, actor: ActorContext, goalId: string): Promise<Goal> {
    // Rolled-up progress depends on the whole tree, so one goal is read with it.
    const all = await this.list(workspaceId, actor);
    const goal = all.find((entry) => entry.id === goalId);
    if (!goal) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Goal not found.');
    return goal;
  }

  private async requireGoal(workspaceId: string, goalId: string) {
    const goal = await this.prisma.goal.findFirst({
      where: { id: goalId, workspaceId, archivedAt: null },
    });
    if (!goal) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Goal not found.');
    return goal;
  }

  /** The owner must be a member here and the team must belong here. */
  private async assertReferences(
    workspaceId: string,
    dto: { ownerId?: string | null; teamId?: string | null },
  ): Promise<void> {
    if (dto.ownerId) {
      const member = await this.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: dto.ownerId } },
        select: { id: true },
      });
      if (!member) {
        throw AppException.badRequest(
          'BAD_REQUEST',
          'The owner must be a member of this workspace.',
        );
      }
    }
    if (dto.teamId) {
      const team = await this.prisma.team.findFirst({
        where: { id: dto.teamId, workspaceId },
        select: { id: true },
      });
      if (!team)
        throw AppException.badRequest('BAD_REQUEST', 'That team is not in this workspace.');
    }
  }

  /** Rows → DTOs, with connected projects filtered and progress rolled up. */
  private async present(
    workspaceId: string,
    actor: ActorContext,
    rows: GoalRow[],
  ): Promise<Goal[]> {
    const projectIds = [
      ...new Set(rows.flatMap((row) => row.projects.map((link) => link.projectId))),
    ];

    const visibleProjects = projectIds.length
      ? await this.prisma.project.findMany({
          where: {
            id: { in: projectIds },
            workspaceId,
            archivedAt: null,
            AND: [this.access.projectWhere(actor)],
          },
          select: { id: true, name: true, color: true },
        })
      : [];

    const visibleIds = visibleProjects.map((project) => project.id);
    /*
     * Counted exactly as the project's own progress is — every task in it,
     * done meaning status DONE — so a goal and the project card it sits beside
     * on the Overview can never show two different numbers for one project.
     */
    // Home and linked tasks alike — the board's count.
    const counts = await projectTaskCounts(this.prisma, visibleIds);
    const completion = new Map<string, number>(
      [...counts.entries()].map(([projectId, count]) => [
        projectId,
        count.total === 0 ? 0 : Math.round((count.done / count.total) * 100),
      ]),
    );
    const refs = new Map<string, GoalProjectRef>(
      visibleProjects.map((project) => [
        project.id,
        { ...project, completion: completion.get(project.id) ?? 0 },
      ]),
    );

    const progress = rollUpProgress(
      rows.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        progressSource: row.progressSource as GoalProgressSource,
        progress: row.progress,
        projectIds: row.projects.map((link) => link.projectId).filter((id) => refs.has(id)),
        metric: metricOf(row),
      })),
      completion,
    );

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspaceId,
      parentId: row.parentId,
      name: row.name,
      description: row.description,
      status: row.status,
      progressSource: row.progressSource,
      progress: progress.get(row.id) ?? 0,
      metric: metricOf(row)
        ? {
            ...(metricOf(row) as { start: number; current: number; target: number }),
            unit: row.metricUnit,
          }
        : null,
      owner: row.owner,
      team: row.team,
      timePeriod: row.timePeriod,
      dueDate: row.dueDate?.toISOString() ?? null,
      projects: row.projects
        .map((link) => refs.get(link.projectId))
        .filter((ref): ref is GoalProjectRef => ref !== undefined),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  }
}

/** A goal's figures, when all three are set; a half-measured goal has none. */
function metricOf(row: {
  metricStart: number | null;
  metricCurrent: number | null;
  metricTarget: number | null;
}): { start: number; current: number; target: number } | null {
  if (row.metricStart === null || row.metricCurrent === null || row.metricTarget === null) {
    return null;
  }
  return { start: row.metricStart, current: row.metricCurrent, target: row.metricTarget };
}
