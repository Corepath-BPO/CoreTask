import {
  ActivityAction,
  ActivityEntity,
  AutomationTrigger,
  MAX_DEPENDENCIES_PER_TASK,
  WorkspaceRole,
} from '@coretask/contracts';
import type {
  ProjectDependency,
  DependencyDirection,
  DependencyTask,
  TaskDependencies,
  TaskLikes,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import { ProjectAccessService } from '../project-access/project-access.service';
import { TasksService } from '../tasks/tasks.service';

import { wouldCloseLoop } from './dependency-graph';

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

const OTHER_END_SELECT = {
  id: true,
  title: true,
  completedAt: true,
  dueDate: true,
  assignee: { select: USER_SELECT },
  project: { select: { id: true, name: true, color: true } },
} as const;

/**
 * Likes and dependencies — the two task relations Asana keeps beside the
 * fields.
 *
 * Every entry point resolves the task through `TasksService.requireTask`
 * with the caller, so a task in another workspace, or in a private project
 * the caller is not on, is a 404 here exactly as it is everywhere else.
 */
@Injectable()
export class TaskRelationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly access: ProjectAccessService,
    private readonly activity: ActivityLogsService,
    private readonly automation: AutomationEventPublisher,
  ) {}

  // -------------------------------------------------------------------------
  // Likes
  // -------------------------------------------------------------------------

  async likes(workspaceId: string, taskId: string, actor: ActorContext): Promise<TaskLikes> {
    await this.tasks.requireTask(workspaceId, taskId, actor);
    return this.readLikes(taskId, actor.userId);
  }

  /**
   * Liking is open to anyone who can see the task, viewers included — it
   * changes nothing about the work, which is why Asana lets comment-only
   * members do it.
   */
  async like(workspaceId: string, taskId: string, actor: ActorContext): Promise<TaskLikes> {
    await this.tasks.requireTask(workspaceId, taskId, actor);

    // The pair is the key: a second like is the same row, not an error.
    await this.prisma.taskLike.upsert({
      where: { taskId_userId: { taskId, userId: actor.userId } },
      create: { taskId, userId: actor.userId },
      update: {},
    });

    return this.readLikes(taskId, actor.userId);
  }

  async unlike(workspaceId: string, taskId: string, actor: ActorContext): Promise<TaskLikes> {
    await this.tasks.requireTask(workspaceId, taskId, actor);
    await this.prisma.taskLike.deleteMany({ where: { taskId, userId: actor.userId } });
    return this.readLikes(taskId, actor.userId);
  }

  private async readLikes(taskId: string, userId: string): Promise<TaskLikes> {
    const rows = await this.prisma.taskLike.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
      select: { user: { select: USER_SELECT } },
    });

    return {
      count: rows.length,
      likedByMe: rows.some((row) => row.user.id === userId),
      users: rows.map((row) => row.user),
    };
  }

  // -------------------------------------------------------------------------
  // Dependencies
  // -------------------------------------------------------------------------

  async dependencies(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
  ): Promise<TaskDependencies> {
    await this.tasks.requireTask(workspaceId, taskId, actor);
    return this.readDependencies(workspaceId, taskId, actor);
  }

  /**
   * Every dependency whose two ends are both tasks of the project — home or
   * linked — for the Timeline's arrows. Seeing the project is seeing its
   * tasks, so nothing here is hidden from someone who may open it.
   */
  async projectDependencies(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectDependency[]> {
    await this.access.resolveAccess(workspaceId, projectId, actor);
    const inProject: Prisma.TaskWhereInput = {
      archivedAt: null,
      OR: [{ projectId }, { projectLinks: { some: { projectId } } }],
    };
    const rows = await this.prisma.taskDependency.findMany({
      where: { workspaceId, blockedTask: inProject, blockingTask: inProject },
      select: { id: true, blockedTaskId: true, blockingTaskId: true },
      orderBy: { createdAt: 'asc' },
      take: 2_000,
    });
    return rows.map((row) => ({
      id: row.id,
      blockingId: row.blockingTaskId,
      blockedId: row.blockedTaskId,
    }));
  }

  async addDependency(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
    otherTaskId: string,
    direction: DependencyDirection,
  ): Promise<TaskDependencies> {
    // Changing what a task waits on is editing it: MEMBER in its project.
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    // The other end only has to be visible — pointing at a task is not editing it.
    const other = await this.tasks.requireTask(workspaceId, otherTaskId, actor);

    const blocked = direction === 'BLOCKED_BY' ? task : other;
    const blocking = direction === 'BLOCKED_BY' ? other : task;

    if (blocked.id === blocking.id) {
      throw AppException.badRequest('BAD_REQUEST', 'A task cannot wait on itself.');
    }

    const existing = await this.prisma.taskDependency.count({
      where: { OR: [{ blockedTaskId: task.id }, { blockingTaskId: task.id }] },
    });
    if (existing >= MAX_DEPENDENCIES_PER_TASK) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A task can have at most ${MAX_DEPENDENCIES_PER_TASK} dependencies.`,
      );
    }

    const loops = await wouldCloseLoop(blocked.id, blocking.id, (ids) => this.waitsOn(ids));
    if (loops) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `“${blocking.title}” already waits on “${blocked.title}”, so this would make a loop that can never start.`,
      );
    }

    try {
      await this.prisma.taskDependency.create({
        data: {
          workspaceId,
          blockedTaskId: blocked.id,
          blockingTaskId: blocking.id,
          createdById: actor.userId,
        },
      });
    } catch (error) {
      // Already there: adding it again asks for what is already true.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
      return this.readDependencies(workspaceId, task.id, actor);
    }

    await this.recordEdge(workspaceId, actor.userId, blocked, blocking, 'added');
    return this.readDependencies(workspaceId, task.id, actor);
  }

  async removeDependency(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
    dependencyId: string,
  ): Promise<TaskDependencies> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);

    const edge = await this.prisma.taskDependency.findFirst({
      where: {
        id: dependencyId,
        workspaceId,
        OR: [{ blockedTaskId: task.id }, { blockingTaskId: task.id }],
      },
      include: {
        blockedTask: {
          select: { id: true, title: true, projectId: true, completedAt: true, archivedAt: true },
        },
        blockingTask: { select: { id: true, title: true, projectId: true, completedAt: true } },
      },
    });

    if (!edge) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Dependency not found.');
    }

    await this.prisma.taskDependency.delete({ where: { id: edge.id } });
    await this.announceIfUnblocked(workspaceId, actor.userId, edge);
    await this.recordEdge(
      workspaceId,
      actor.userId,
      edge.blockedTask,
      edge.blockingTask,
      'removed',
    );
    return this.readDependencies(workspaceId, task.id, actor);
  }

  /**
   * "Task is no longer blocked", when unlinking freed the task.
   *
   * Only when the link removed was holding it — an unfinished blocker — and
   * nothing unfinished blocks it still. Completing a blocker raises the same
   * event from the engine; this is the other way a task comes free.
   */
  private async announceIfUnblocked(
    workspaceId: string,
    actorId: string,
    edge: {
      blockedTask: {
        id: string;
        projectId: string | null;
        completedAt: Date | null;
        archivedAt: Date | null;
      };
      blockingTask: { id: string; completedAt: Date | null };
    },
  ): Promise<void> {
    const blocked = edge.blockedTask;
    if (edge.blockingTask.completedAt !== null) return;
    if (!blocked.projectId || blocked.completedAt !== null || blocked.archivedAt !== null) return;

    const stillBlocking = await this.prisma.taskDependency.count({
      where: { blockedTaskId: blocked.id, blockingTask: { completedAt: null, archivedAt: null } },
    });
    if (stillBlocking > 0) return;

    await this.automation.publish({
      workspaceId,
      projectId: blocked.projectId,
      trigger: AutomationTrigger.TASK_NO_LONGER_BLOCKED,
      entityType: 'TASK',
      entityId: blocked.id,
      actorId,
      before: { blocked: true },
      after: { blocked: false, blockerId: edge.blockingTask.id },
    });
  }

  /** One hop of the graph: for each task, what it waits on. */
  private async waitsOn(taskIds: string[]): Promise<Map<string, string[]>> {
    const rows = await this.prisma.taskDependency.findMany({
      where: { blockedTaskId: { in: taskIds } },
      select: { blockedTaskId: true, blockingTaskId: true },
    });

    const edges = new Map<string, string[]>();
    for (const row of rows) {
      edges.set(row.blockedTaskId, [...(edges.get(row.blockedTaskId) ?? []), row.blockingTaskId]);
    }
    return edges;
  }

  /**
   * Both directions, with the far end's essentials.
   *
   * The far end is filtered through the caller's project visibility: a task
   * may wait on work in a private project, and someone who cannot see that
   * project learns nothing about it from here — the edge is simply not listed.
   */
  private async readDependencies(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
  ): Promise<TaskDependencies> {
    const visible = this.access.taskWhere(actor);

    const [blockedBy, blocking] = await Promise.all([
      this.prisma.taskDependency.findMany({
        where: {
          workspaceId,
          blockedTaskId: taskId,
          blockingTask: { archivedAt: null, AND: [visible] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, blockingTask: { select: OTHER_END_SELECT } },
      }),
      this.prisma.taskDependency.findMany({
        where: {
          workspaceId,
          blockingTaskId: taskId,
          blockedTask: { archivedAt: null, AND: [visible] },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, blockedTask: { select: OTHER_END_SELECT } },
      }),
    ]);

    return {
      blockedBy: blockedBy.map((row) => toDependencyTask(row.id, row.blockingTask)),
      blocking: blocking.map((row) => toDependencyTask(row.id, row.blockedTask)),
    };
  }

  /** A story on each end, so both panes' histories say what changed. */
  private async recordEdge(
    workspaceId: string,
    actorId: string,
    blocked: { id: string; title: string; projectId: string | null },
    blocking: { id: string; title: string; projectId: string | null },
    change: 'added' | 'removed',
  ): Promise<void> {
    const added = change === 'added';

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.TASK,
      entityId: blocked.id,
      projectId: blocked.projectId,
      summary: added
        ? `Marked as waiting on “${blocking.title}”`
        : `Removed the dependency on “${blocking.title}”`,
      metadata: { dependency: { change, role: 'BLOCKED', otherTaskId: blocking.id } },
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.TASK,
      entityId: blocking.id,
      projectId: blocking.projectId,
      summary: added
        ? `Marked as blocking “${blocked.title}”`
        : `Stopped blocking “${blocked.title}”`,
      metadata: { dependency: { change, role: 'BLOCKING', otherTaskId: blocked.id } },
    });
  }
}

function toDependencyTask(
  dependencyId: string,
  task: Prisma.TaskGetPayload<{ select: typeof OTHER_END_SELECT }>,
): DependencyTask {
  return {
    dependencyId,
    id: task.id,
    title: task.title,
    isCompleted: task.completedAt !== null,
    dueDate: task.dueDate?.toISOString() ?? null,
    assignee: task.assignee,
    project: task.project,
  };
}
