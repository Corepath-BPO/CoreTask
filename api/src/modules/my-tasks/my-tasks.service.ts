import { myTasksRulesOf, type MyTasksBucket, type MyTasksRules } from '@coretask/contracts';
import type { MyTaskPlacement } from '@coretask/types';
import { Injectable } from '@nestjs/common';

import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { TasksService } from '../tasks/tasks.service';

/**
 * Where the caller's tasks sit in their own My Tasks.
 *
 * Placement is personal, so it is open to anyone who can see the task — it
 * changes nothing about the work. Moving a task back to "Recently assigned"
 * deletes the row rather than storing the default, so the table holds only
 * choices someone actually made.
 */
@Injectable()
export class MyTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
  ) {}

  async placements(workspaceId: string, actor: ActorContext): Promise<MyTaskPlacement[]> {
    const rows = await this.prisma.myTaskPlacement.findMany({
      where: { userId: actor.userId, task: { workspaceId, archivedAt: null } },
      select: { taskId: true, bucket: true, updatedAt: true },
    });
    return rows.map((row) => ({
      taskId: row.taskId,
      bucket: row.bucket,
      placedAt: row.updatedAt.toISOString(),
    }));
  }

  /** The caller's auto-sort rules in this workspace, defaults filling gaps. */
  async rules(workspaceId: string, actor: ActorContext): Promise<MyTasksRules> {
    const member = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
      select: { myTasksRules: true },
    });
    return myTasksRulesOf(member.myTasksRules);
  }

  async setRules(
    workspaceId: string,
    actor: ActorContext,
    changes: Partial<MyTasksRules>,
  ): Promise<MyTasksRules> {
    const next = { ...(await this.rules(workspaceId, actor)), ...changes };
    await this.prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
      data: { myTasksRules: { dueToday: next.dueToday, dueThisWeek: next.dueThisWeek } },
    });
    return next;
  }

  async place(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
    bucket: MyTasksBucket,
  ): Promise<MyTaskPlacement> {
    await this.tasks.requireTask(workspaceId, taskId, actor);

    // Kept even for Recently assigned: the row's time is what lets a move made
    // today outrank the auto-sort rules.
    const row = await this.prisma.myTaskPlacement.upsert({
      where: { userId_taskId: { userId: actor.userId, taskId } },
      create: { userId: actor.userId, taskId, bucket },
      update: { bucket },
      select: { taskId: true, bucket: true, updatedAt: true },
    });
    return { taskId: row.taskId, bucket: row.bucket, placedAt: row.updatedAt.toISOString() };
  }
}
