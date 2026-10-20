import {
  CHECKLIST_ITEM_MAX,
  CHECKLIST_NAME_MAX,
  MAX_CHECKLISTS_PER_TASK,
  MAX_CHECKLIST_ITEMS,
  POSITION_STEP,
  WorkspaceRole,
} from '@coretask/contracts';
import type {
  CreateChecklistPayload,
  TaskChecklist,
  UpdateChecklistItemPayload,
  UpdateChecklistPayload,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { ActivityAction, ActivityEntity, type Prisma, type Task } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

import { TasksService } from './tasks.service';

const person = { select: { id: true, name: true } } as const;

const checklistInclude = {
  createdBy: person,
  items: {
    include: { completedBy: person },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.TaskChecklistInclude;

type ChecklistRow = Prisma.TaskChecklistGetPayload<{ include: typeof checklistInclude }>;

const toDto = (row: ChecklistRow): TaskChecklist => ({
  id: row.id,
  taskId: row.taskId,
  name: row.name,
  position: row.position,
  items: row.items.map((item) => ({
    id: item.id,
    title: item.title,
    position: item.position,
    completed: item.completedAt !== null,
    completedAt: item.completedAt?.toISOString() ?? null,
    completedBy: item.completedBy,
  })),
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

/** Trimmed, and refused when nothing is left — a nameless list is no list. */
function required(value: string, what: string, max: number): string {
  const trimmed = value.trim().slice(0, max);
  if (!trimmed) throw AppException.badRequest('BAD_REQUEST', `The ${what} cannot be empty.`);
  return trimmed;
}

/**
 * Checklists — named lists of things to tick off, on one task.
 *
 * Lighter than subtasks: an item has no assignee, due date or story of its
 * own, only a title and whether it is done. The "Add a checklist" automation
 * step writes the same rows.
 *
 * Anyone who can see the task can read its checklists; anyone who can edit the
 * task can change them. Every write answers with the task's checklists as they
 * now are, so the panel never has to stitch one change into what it holds.
 */
@Injectable()
export class TaskChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityLogsService,
  ) {}

  async list(workspaceId: string, taskId: string, actor: ActorContext): Promise<TaskChecklist[]> {
    await this.tasks.requireTask(workspaceId, taskId, actor);
    return this.read(taskId);
  }

  async create(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
    payload: CreateChecklistPayload,
  ): Promise<TaskChecklist[]> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    const name = required(payload.name, 'checklist’s name', CHECKLIST_NAME_MAX);
    const items = (payload.items ?? [])
      .map((item) => item.trim().slice(0, CHECKLIST_ITEM_MAX))
      .filter((item) => item !== '')
      .slice(0, MAX_CHECKLIST_ITEMS);

    const existing = await this.prisma.taskChecklist.aggregate({
      where: { taskId },
      _count: { _all: true },
      _max: { position: true },
    });
    if (existing._count._all >= MAX_CHECKLISTS_PER_TASK) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A task holds up to ${MAX_CHECKLISTS_PER_TASK} checklists.`,
      );
    }

    await this.prisma.taskChecklist.create({
      data: {
        workspaceId,
        taskId,
        name,
        position: (existing._max.position ?? 0) + POSITION_STEP,
        createdById: actor.userId,
        items: {
          create: items.map((title, index) => ({ title, position: (index + 1) * POSITION_STEP })),
        },
      },
    });

    await this.record(task, actor, `Added the checklist “${name}”`);
    return this.read(taskId);
  }

  async update(
    workspaceId: string,
    taskId: string,
    checklistId: string,
    actor: ActorContext,
    payload: UpdateChecklistPayload,
  ): Promise<TaskChecklist[]> {
    await this.requireChecklist(workspaceId, taskId, checklistId, actor);
    await this.prisma.taskChecklist.update({
      where: { id: checklistId },
      data: {
        ...(payload.name !== undefined
          ? { name: required(payload.name, 'checklist’s name', CHECKLIST_NAME_MAX) }
          : {}),
        ...(payload.position !== undefined ? { position: payload.position } : {}),
      },
    });
    return this.read(taskId);
  }

  async remove(
    workspaceId: string,
    taskId: string,
    checklistId: string,
    actor: ActorContext,
  ): Promise<TaskChecklist[]> {
    const { task, checklist } = await this.requireChecklist(
      workspaceId,
      taskId,
      checklistId,
      actor,
    );
    await this.prisma.taskChecklist.delete({ where: { id: checklistId } });
    await this.record(task, actor, `Removed the checklist “${checklist.name}”`);
    return this.read(taskId);
  }

  async addItem(
    workspaceId: string,
    taskId: string,
    checklistId: string,
    actor: ActorContext,
    title: string,
  ): Promise<TaskChecklist[]> {
    await this.requireChecklist(workspaceId, taskId, checklistId, actor);
    const text = required(title, 'item', CHECKLIST_ITEM_MAX);

    const existing = await this.prisma.taskChecklistItem.aggregate({
      where: { checklistId },
      _count: { _all: true },
      _max: { position: true },
    });
    if (existing._count._all >= MAX_CHECKLIST_ITEMS) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A checklist holds up to ${MAX_CHECKLIST_ITEMS} items.`,
      );
    }

    await this.prisma.taskChecklistItem.create({
      data: {
        checklistId,
        title: text,
        position: (existing._max.position ?? 0) + POSITION_STEP,
      },
    });
    return this.read(taskId);
  }

  async updateItem(
    workspaceId: string,
    taskId: string,
    checklistId: string,
    itemId: string,
    actor: ActorContext,
    payload: UpdateChecklistItemPayload,
  ): Promise<TaskChecklist[]> {
    const { task } = await this.requireChecklist(workspaceId, taskId, checklistId, actor);
    const item = await this.requireItem(checklistId, itemId);

    // Ticking an already-ticked item keeps who ticked it first and when.
    const ticking = payload.completed === true && item.completedAt === null;
    const unticking = payload.completed === false && item.completedAt !== null;

    await this.prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: {
        ...(payload.title !== undefined
          ? { title: required(payload.title, 'item', CHECKLIST_ITEM_MAX) }
          : {}),
        ...(payload.position !== undefined ? { position: payload.position } : {}),
        ...(ticking
          ? { completedAt: new Date(), completedBy: { connect: { id: actor.userId } } }
          : {}),
        ...(unticking ? { completedAt: null, completedBy: { disconnect: true } } : {}),
      },
    });

    if (ticking) await this.record(task, actor, `Ticked “${item.title}”`);
    if (unticking) await this.record(task, actor, `Unticked “${item.title}”`);
    return this.read(taskId);
  }

  async removeItem(
    workspaceId: string,
    taskId: string,
    checklistId: string,
    itemId: string,
    actor: ActorContext,
  ): Promise<TaskChecklist[]> {
    await this.requireChecklist(workspaceId, taskId, checklistId, actor);
    await this.requireItem(checklistId, itemId);
    await this.prisma.taskChecklistItem.delete({ where: { id: itemId } });
    return this.read(taskId);
  }

  private async read(taskId: string): Promise<TaskChecklist[]> {
    const rows = await this.prisma.taskChecklist.findMany({
      where: { taskId },
      include: checklistInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toDto);
  }

  /** The task, editable by the caller, and one of its checklists. */
  private async requireChecklist(
    workspaceId: string,
    taskId: string,
    checklistId: string,
    actor: ActorContext,
  ) {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    const checklist = await this.prisma.taskChecklist.findFirst({
      where: { id: checklistId, taskId, workspaceId },
      select: { id: true, name: true },
    });
    if (!checklist) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Checklist not found.');
    return { task, checklist };
  }

  private async requireItem(checklistId: string, itemId: string) {
    const item = await this.prisma.taskChecklistItem.findFirst({
      where: { id: itemId, checklistId },
      select: { id: true, title: true, completedAt: true },
    });
    if (!item) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Checklist item not found.');
    return item;
  }

  private record(task: Task, actor: ActorContext, summary: string) {
    return this.activity.record({
      workspaceId: task.workspaceId,
      actorId: actor.userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.TASK,
      entityId: task.id,
      projectId: task.projectId,
      summary,
    });
  }
}
