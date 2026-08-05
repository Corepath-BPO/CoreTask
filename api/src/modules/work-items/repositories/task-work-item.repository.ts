import type {
  CreateWorkItemPayload,
  ProjectWorkItem,
  ProjectWorkItemQuery,
  UpdateWorkItemPayload,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { Prisma, TaskPriority, TaskStatus } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import { PrismaService } from '../../../database/prisma.service';
import { taskToWorkItem, workItemTaskInclude } from '../lib/work-item.mapper';

type TaskRow = Prisma.TaskGetPayload<{ include: typeof workItemTaskInclude }>;

const toDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(value);

/**
 * The task half of a work item.
 *
 * Everything that knows a work item might be a `Task` lives here. The service
 * above decides *what* happens; this decides which columns move — which is what
 * keeps the shared layer from slowly growing a `if (type === TASK)` in every
 * method.
 */
@Injectable()
export class TaskWorkItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    workspaceId: string,
    projectId: string,
    query: ProjectWorkItemQuery,
  ): Promise<TaskRow[]> {
    return this.prisma.task.findMany({
      where: {
        workspaceId,
        projectId,
        // Top-level only. Subtasks are fetched when a row is expanded — a
        // project of two hundred tasks would otherwise ship every child nobody
        // looked at.
        parentTaskId: null,
        ...(query.includeArchived ? {} : { archivedAt: null }),
        ...(query.sectionId === undefined ? {} : { sectionId: query.sectionId }),
        ...(query.search
          ? { title: { contains: query.search, mode: Prisma.QueryMode.insensitive } }
          : {}),
      },
      include: workItemTaskInclude,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      // Capped independently of the page size so one kind cannot use up the
      // whole budget and hide the other entirely.
      take: (query.limit ?? 200) + 1,
    });
  }

  async create(
    workspaceId: string,
    projectId: string,
    userId: string,
    payload: CreateWorkItemPayload,
    sectionId: string | null,
    position: number,
  ): Promise<ProjectWorkItem> {
    const parent = payload.parentId
      ? await this.prisma.task.findFirst({
          where: { id: payload.parentId, workspaceId, projectId },
          select: { id: true, parentTaskId: true },
        })
      : null;

    if (payload.parentId && !parent) {
      throw AppException.badRequest('BAD_REQUEST', 'That parent is not in this project.');
    }

    if (parent?.parentTaskId) {
      // One level of nesting, the same rule the task module enforces. A deeper
      // tree needs a recursive rollup and a UI that can draw it; allowing it
      // quietly produces rows nothing renders.
      throw AppException.badRequest('BAD_REQUEST', 'A subtask cannot have its own subtasks.');
    }

    await this.assertAssigneesAreMembers(workspaceId, payload.assigneeIds);

    const created = await this.prisma.task.create({
      data: {
        workspaceId,
        projectId,
        sectionId,
        parentTaskId: payload.parentId ?? null,
        title: payload.title,
        description: payload.description ?? null,
        position,
        // A task carries one assignee; the contract allows a list because other
        // kinds may. The first is taken rather than silently dropping the rest.
        assigneeId: payload.assigneeIds?.[0] ?? null,
        createdById: userId,
        ...(payload.statusId ? this.statusData(payload.statusId) : {}),
        startDate: toDate(payload.startDate) ?? null,
        dueDate: toDate(payload.dueDate) ?? null,
      },
      include: workItemTaskInclude,
    });

    return taskToWorkItem(created);
  }

  async update(
    workspaceId: string,
    taskId: string,
    payload: UpdateWorkItemPayload,
  ): Promise<ProjectWorkItem> {
    await this.assertAssigneesAreMembers(workspaceId, payload.assigneeIds);

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.description === undefined ? {} : { description: payload.description }),
        ...(payload.statusId ? this.statusData(payload.statusId) : {}),
        ...(payload.priorityId ? this.priorityData(payload.priorityId) : {}),
        ...(payload.assigneeIds === undefined
          ? {}
          : { assigneeId: payload.assigneeIds[0] ?? null }),
        ...(payload.startDate === undefined ? {} : { startDate: toDate(payload.startDate) }),
        ...(payload.dueDate === undefined ? {} : { dueDate: toDate(payload.dueDate) }),
      },
      include: workItemTaskInclude,
    });

    return taskToWorkItem(updated);
  }

  async move(
    workspaceId: string,
    taskId: string,
    sectionId: string | null,
    position: number,
  ): Promise<ProjectWorkItem> {
    const section = sectionId
      ? await this.prisma.section.findFirst({
          where: { id: sectionId },
          select: { defaultStatusId: true },
        })
      : null;

    const moved = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        sectionId,
        position,
        /*
         * The section's default status, only when it has opted in.
         *
         * A section is a workflow column and a status is task state; coupling
         * them by default is how "drag a card" becomes an unexplained status
         * change. `defaultStatusId` is null unless somebody chose otherwise.
         */
        ...(section?.defaultStatusId ? { statusDefinitionId: section.defaultStatusId } : {}),
      },
      include: workItemTaskInclude,
    });

    return taskToWorkItem(moved);
  }

  /**
   * Accepts a definition id or the legacy enum value.
   *
   * `Task.status` is still authoritative while the backfill is verified, so the
   * mapper hands out an enum name as the id when a task has no definition —
   * and whatever it hands out has to be accepted back, or a status set from the
   * List would fail on exactly the rows that need it most.
   */
  private statusData(statusId: string): { status?: TaskStatus; statusDefinitionId?: string } {
    if (statusId in TaskStatus) {
      return { status: statusId as TaskStatus };
    }

    // The scalar rather than a `connect`: this object is spread into both a
    // create and an update, and the relation form is only valid in one of them.
    return { statusDefinitionId: statusId };
  }

  private priorityData(priorityId: string): {
    priority?: TaskPriority;
    priorityDefinitionId?: string;
  } {
    if (priorityId in TaskPriority) {
      return { priority: priorityId as TaskPriority };
    }

    return { priorityDefinitionId: priorityId };
  }

  /**
   * Assignees must be members of this workspace.
   *
   * Without it, a work item is a way to attach an arbitrary user id to a
   * project — and that id then appears in a picker, a notification and a
   * report as though the person belonged there.
   */
  private async assertAssigneesAreMembers(
    workspaceId: string,
    assigneeIds: string[] | undefined,
  ): Promise<void> {
    if (!assigneeIds?.length) return;

    const count = await this.prisma.workspaceMember.count({
      where: { workspaceId, userId: { in: assigneeIds } },
    });

    if (count !== new Set(assigneeIds).size) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'An assignee is not a member of this workspace.',
      );
    }
  }
}
