import { WorkspaceRole, formatMinutes, hasAtLeastRole } from '@coretask/contracts';
import type { LogTimePayload, TaskTime, TimeEntry } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { ActivityAction, ActivityEntity, type Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

import { TasksService } from './tasks.service';

const entryInclude = {
  user: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.TimeEntryInclude;

type EntryRow = Prisma.TimeEntryGetPayload<{ include: typeof entryInclude }>;

const toDto = (row: EntryRow): TimeEntry => ({
  id: row.id,
  taskId: row.taskId,
  minutes: row.minutes,
  date: row.date.toISOString().slice(0, 10),
  note: row.note,
  user: row.user,
  createdAt: row.createdAt.toISOString(),
});

/** `YYYY-MM-DD`, or today, as the date column takes it. */
const dayOf = (date: string | undefined) =>
  new Date(`${(date ?? new Date().toISOString()).slice(0, 10)}T00:00:00.000Z`);

/**
 * Time tracking — the actual time logged against a task, beside its estimate.
 *
 * Anyone who can see the task can read its time; anyone who can edit it can
 * log time; an entry is changed or removed by whoever logged it, or a manager.
 */
@Injectable()
export class TimeEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityLogsService,
  ) {}

  async list(workspaceId: string, taskId: string, actor: ActorContext): Promise<TaskTime> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor);
    const rows = await this.prisma.timeEntry.findMany({
      where: { taskId },
      include: entryInclude,
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    return {
      entries: rows.map(toDto),
      totalMinutes: rows.reduce((sum, row) => sum + row.minutes, 0),
      estimatedMinutes: task.estimatedMinutes,
    };
  }

  async log(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
    payload: LogTimePayload,
  ): Promise<TaskTime> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    await this.prisma.timeEntry.create({
      data: {
        workspaceId,
        taskId,
        userId: actor.userId,
        minutes: payload.minutes,
        date: dayOf(payload.date),
        note: payload.note?.trim() || null,
      },
    });

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.TASK,
      entityId: taskId,
      projectId: task.projectId,
      summary: `Logged ${formatMinutes(payload.minutes)}`,
      metadata: { minutes: payload.minutes },
    });

    return this.list(workspaceId, taskId, actor);
  }

  async update(
    workspaceId: string,
    taskId: string,
    entryId: string,
    actor: ActorContext,
    payload: Partial<LogTimePayload>,
  ): Promise<TaskTime> {
    await this.requireOwnEntry(workspaceId, taskId, entryId, actor);
    await this.prisma.timeEntry.update({
      where: { id: entryId },
      data: {
        ...(payload.minutes !== undefined ? { minutes: payload.minutes } : {}),
        ...(payload.date !== undefined ? { date: dayOf(payload.date) } : {}),
        ...(payload.note !== undefined ? { note: payload.note?.trim() || null } : {}),
      },
    });
    return this.list(workspaceId, taskId, actor);
  }

  async remove(
    workspaceId: string,
    taskId: string,
    entryId: string,
    actor: ActorContext,
  ): Promise<TaskTime> {
    await this.requireOwnEntry(workspaceId, taskId, entryId, actor);
    await this.prisma.timeEntry.delete({ where: { id: entryId } });
    return this.list(workspaceId, taskId, actor);
  }

  private async requireOwnEntry(
    workspaceId: string,
    taskId: string,
    entryId: string,
    actor: ActorContext,
  ) {
    await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id: entryId, taskId, workspaceId },
      select: { userId: true },
    });
    if (!entry) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Time entry not found.');
    if (entry.userId !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only whoever logged this time, or a manager, can change it.',
      );
    }
  }
}
