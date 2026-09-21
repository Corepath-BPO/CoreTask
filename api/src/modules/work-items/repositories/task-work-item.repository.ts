import type {
  CreateWorkItemPayload,
  ProjectWorkItem,
  ProjectWorkItemQuery,
  UpdateWorkItemPayload,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { Prisma, StatusCategory, TaskPriority, TaskStatus } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';
import { normalizeRichText } from '../../../common/utils/rich-text.util';
import { initialSchedule, resolveSchedule } from '../../../common/utils/schedule.util';
import { PrismaService } from '../../../database/prisma.service';
import { taskToWorkItem, workItemTaskInclude } from '../lib/work-item.mapper';

type TaskRow = Prisma.TaskGetPayload<{ include: typeof workItemTaskInclude }>;

/** How many rows of one kind an ordered read considers. */
export const ORDER_CANDIDATE_LIMIT = 2000;

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
    filters: readonly Prisma.TaskWhereInput[] = [],
  ): Promise<TaskRow[]> {
    return this.prisma.task.findMany({
      where: this.buildWhere(workspaceId, projectId, query, filters),
      include: workItemTaskInclude,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      // Capped independently of the page size so one kind cannot use up the
      // whole budget and hide the other entirely.
      take: (query.limit ?? 200) + 1,
    });
  }

  /**
   * The ids that match, for the ordered path.
   *
   * Predicates stay here, in Prisma; only the ordering goes to SQL, over this
   * allowlist. Capped well above a page so a sort can see past the first
   * two hundred rows, but not unbounded.
   */
  async listIds(
    workspaceId: string,
    projectId: string,
    query: ProjectWorkItemQuery,
    filters: readonly Prisma.TaskWhereInput[],
  ): Promise<string[]> {
    const rows = await this.prisma.task.findMany({
      where: this.buildWhere(workspaceId, projectId, query, filters),
      select: { id: true },
      take: ORDER_CANDIDATE_LIMIT,
    });
    return rows.map((row) => row.id);
  }

  /** Full rows for ids already ordered, returned in that order. */
  async hydrate(ids: readonly string[]): Promise<TaskRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.task.findMany({
      where: { id: { in: [...ids] } },
      include: workItemTaskInclude,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is TaskRow => row !== undefined);
  }

  /**
   * One `where` for both the default and the ordered path, so a filter that
   * works without a sort works with one.
   */
  private buildWhere(
    workspaceId: string,
    projectId: string,
    query: ProjectWorkItemQuery,
    filters: readonly Prisma.TaskWhereInput[],
  ): Prisma.TaskWhereInput {
    return {
      workspaceId,
      projectId,
      // Top-level only. Subtasks are fetched when a row is expanded — a
      // project of two hundred tasks would otherwise ship every child nobody
      // looked at.
      parentTaskId: null,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.showCompleted === false ? { completedAt: null } : {}),
      ...(query.sectionId === undefined ? {} : { sectionId: query.sectionId }),
      ...(query.search
        ? { title: { contains: query.search, mode: Prisma.QueryMode.insensitive } }
        : {}),
      // AND rather than spreading: two conditions on the same field would
      // otherwise overwrite each other and silently drop a filter.
      ...(filters.length > 0 ? { AND: [...filters] } : {}),
    };
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

    const start = initialSchedule({ date: payload.startDate, at: payload.startAt }, 'start');
    const due = initialSchedule({ date: payload.dueDate, at: payload.dueAt }, 'due');

    const created = await this.prisma.task.create({
      data: {
        workspaceId,
        projectId,
        sectionId,
        parentTaskId: payload.parentId ?? null,
        title: payload.title,
        description: normalizeRichText(payload.description) ?? null,
        position,
        // A task carries one assignee; the contract allows a list because other
        // kinds may. The first is taken rather than silently dropping the rest.
        assigneeId: payload.assigneeIds?.[0] ?? null,
        createdById: userId,
        ...(payload.statusId ? this.statusData(payload.statusId) : {}),
        // The schema accepts a priority at create — dropping it here meant a
        // task created with one arrived without it, while update honoured it.
        ...(payload.priorityId ? this.priorityData(payload.priorityId) : {}),
        startDate: start.date,
        startAt: start.at,
        dueDate: due.date,
        dueAt: due.at,
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

    /*
     * The date and its time move as a pair, and how they move depends on what
     * is already there — so the current values are read first, but only when
     * a date field is in the payload at all. A title edit stays one query.
     */
    const touchesDates =
      payload.startDate !== undefined ||
      payload.startAt !== undefined ||
      payload.dueDate !== undefined ||
      payload.dueAt !== undefined;
    // The status too: whether the task is done follows from it, and that
    // needs the completion time it has now.
    const touchesStatus = Boolean(payload.statusId);
    const existing =
      touchesDates || touchesStatus
        ? await this.prisma.task.findFirstOrThrow({
            where: { id: taskId, workspaceId },
            select: {
              startDate: true,
              startAt: true,
              dueDate: true,
              dueAt: true,
              completedAt: true,
            },
          })
        : null;
    const start =
      existing && touchesDates
        ? resolveSchedule(
            { date: existing.startDate, at: existing.startAt },
            { date: payload.startDate, at: payload.startAt },
            'start',
          )
        : {};
    const due =
      existing && touchesDates
        ? resolveSchedule(
            { date: existing.dueDate, at: existing.dueAt },
            { date: payload.dueDate, at: payload.dueAt },
            'due',
          )
        : {};
    const completion =
      existing && payload.statusId
        ? await this.completionData(payload.statusId, existing.completedAt)
        : {};

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(payload.title === undefined ? {} : { title: payload.title }),
        ...(payload.description === undefined
          ? {}
          : { description: normalizeRichText(payload.description) }),
        ...(payload.statusId ? this.statusData(payload.statusId) : {}),
        ...completion,
        ...(payload.priorityId ? this.priorityData(payload.priorityId) : {}),
        ...(payload.assigneeIds === undefined
          ? {}
          : { assigneeId: payload.assigneeIds[0] ?? null }),
        ...(start.date === undefined ? {} : { startDate: start.date }),
        ...(start.at === undefined ? {} : { startAt: start.at }),
        ...(due.date === undefined ? {} : { dueDate: due.date }),
        ...(due.at === undefined ? {} : { dueAt: due.at }),
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
   * Archives a task and its subtasks together, as the task module does.
   *
   * Idempotent rather than a 409: a selection archived in bulk may already
   * hold an archived row, and refusing the whole request for it would leave the
   * person counting which of their twenty rows was the one.
   */
  async archive(workspaceId: string, taskId: string): Promise<ProjectWorkItem> {
    const archivedAt = new Date();

    const archived = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.task.findFirstOrThrow({
        where: { id: taskId, workspaceId },
        select: { archivedAt: true },
      });

      if (existing.archivedAt !== null) {
        return tx.task.findUniqueOrThrow({
          where: { id: taskId },
          include: workItemTaskInclude,
        });
      }

      // A hidden parent must not leave visible children stranded under it.
      await tx.task.updateMany({
        where: { parentTaskId: taskId, archivedAt: null },
        data: { archivedAt },
      });

      return tx.task.update({
        where: { id: taskId },
        data: { archivedAt },
        include: workItemTaskInclude,
      });
    });

    return taskToWorkItem(archived);
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
   * `completedAt`, kept in step with the status.
   *
   * The task module derives it from the status on every edit; this path did
   * not, so a task ticked off in the List carried `DONE` with no completion
   * time. Nothing looked wrong on screen — the strike-through reads the
   * status — but "task completed" is raised off this column, so no rule ever
   * heard about it, while the same tick on a subtask, which takes the other
   * path, fired every time.
   *
   * A legacy `DONE`, or a definition in the COMPLETED category, is done.
   * Stamped once on the way in and cleared on the way out, as the task module
   * does it, so the time survives a re-save of the same status.
   */
  private async completionData(
    statusId: string,
    completedAt: Date | null,
  ): Promise<{ completedAt?: Date | null }> {
    const done =
      statusId in TaskStatus
        ? statusId === TaskStatus.DONE
        : (
            await this.prisma.statusDefinition.findFirst({
              where: { id: statusId },
              select: { category: true },
            })
          )?.category === StatusCategory.COMPLETED;

    if (done && completedAt === null) return { completedAt: new Date() };
    if (!done && completedAt !== null) return { completedAt: null };

    return {};
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
