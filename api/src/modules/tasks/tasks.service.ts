import {
  ActivityAction,
  ActivityEntity,
  AutomationTrigger,
  NotificationType,
  ServerEvent,
  TaskStatus,
} from '@coretask/contracts';
import type { Task, TaskDetail, TaskListMeta, TaskListSummary } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Task as PrismaTask } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import {
  compileFilters,
  compileSorts,
  type CustomFieldMap,
} from '../project-views/lib/query-compiler';
import { PaginatedResult } from '../../common/types/api.types';
import { buildPaginationMeta, toSkipTake } from '../../common/utils/pagination.util';
import { planPlacement, type OrderedItem } from '../../common/utils/position.util';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

import type { CreateTaskDto, MoveTaskDto, TaskListQueryDto, UpdateTaskDto } from './dto/task.dto';
import {
  taskDetailInclude,
  taskInclude,
  toTaskDetailDto,
  toTaskDto,
  type TaskWithRelations,
} from './task.mapper';

/**
 * What a view asks for. Declared here rather than imported from the controller,
 * so the read path does not depend on the shape of an HTTP request.
 */
export interface ViewQuery {
  page: number;
  limit: number;
  search?: string;
  filters?: { field: string; operator: never; value?: never }[];
  sorts?: { field: string; direction: never }[];
}

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogsService,
    private readonly realtime: RealtimeGateway,
    private readonly automation: AutomationEventPublisher,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async list(
    workspaceId: string,
    userId: string,
    query: TaskListQueryDto,
  ): Promise<PaginatedResult<Task, TaskListMeta>> {
    const where = this.buildWhere(workspaceId, userId, query);

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        include: taskInclude,
        // Board order first (section, then position); createdAt breaks ties so
        // paging stays stable if two positions ever collide.
        orderBy: [{ sectionId: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
        ...toSkipTake(query),
      }),
    ]);

    const [summary, completed] = await Promise.all([
      this.summarize(where, total),
      this.completedSubtaskCounts(tasks.map((task) => task.id)),
    ]);

    return new PaginatedResult(
      tasks.map((task) => toTaskDto(task, completed.get(task.id) ?? 0)),
      { ...buildPaginationMeta(query, total), summary },
    );
  }

  /**
   * The task list behind a project view: filtered, sorted and grouped.
   *
   * Lives here rather than in the views module so there is exactly one task
   * read path — the same include, the same DTO, the same subtask counts. A view
   * decides *which* tasks and in *what order*; it does not get its own idea of
   * what a task is.
   *
   * Filtering happens in PostgreSQL, never in the client. A project with ten
   * thousand tasks must not ship all of them so the browser can hide most.
   */
  async listForView(
    workspaceId: string,
    projectId: string,
    query: ViewQuery,
    customFields: CustomFieldMap,
  ): Promise<PaginatedResult<Task, TaskListMeta>> {
    const conditions = compileFilters(query.filters ?? [], customFields);

    const where: Prisma.TaskWhereInput = {
      workspaceId,
      projectId,
      archivedAt: null,
      // Subtasks belong under their parent, not as sibling rows in a list.
      parentTaskId: null,
      ...(query.search
        ? { title: { contains: query.search, mode: Prisma.QueryMode.insensitive } }
        : {}),
      // AND rather than spreading: two conditions on the same field would
      // otherwise overwrite each other and silently drop a filter.
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    };

    const [total, tasks] = await Promise.all([
      this.prisma.task.count({ where }),
      this.prisma.task.findMany({
        where,
        include: taskInclude,
        orderBy: compileSorts(query.sorts ?? []),
        ...toSkipTake(query),
      }),
    ]);

    const [summary, completed, customFieldValues] = await Promise.all([
      this.summarize(where, total),
      this.completedSubtaskCounts(tasks.map((task) => task.id)),
      // One query for the whole page rather than one per row. A list of a
      // hundred tasks with four custom fields each is four hundred values, and
      // fetching them per task is the N+1 the spec warns about by name.
      this.customFieldValues(tasks.map((task) => task.id)),
    ]);

    return new PaginatedResult(
      tasks.map((task) => ({
        ...toTaskDto(task, completed.get(task.id) ?? 0),
        customFieldValues: customFieldValues.get(task.id) ?? [],
      })),
      { ...buildPaginationMeta(query, total), summary },
    );
  }

  /**
   * The subtasks of one parent, shaped exactly like the rows above them.
   *
   * Separate from `listForView` rather than a `parentTaskId` filter on it: that
   * endpoint compiles a saved view's filters and sorts against a closed set of
   * fields, and a drill-down is not a view. Keeping them apart means expanding
   * a row cannot be made to reach outside the project by way of a filter.
   *
   * Unpaged on purpose — nesting is one level deep and a parent with enough
   * children to need paging is a parent that wants to be its own project.
   */
  async listSubtasksForView(
    workspaceId: string,
    projectId: string,
    parentTaskId: string,
  ): Promise<Task[]> {
    /*
     * The parent is verified against this workspace *and* project before its
     * children are read. Without it, a task id from another workspace would
     * return that workspace's subtasks: the guard proves the caller belongs to
     * the workspace in the URL, never that the id in the path does.
     */
    const parent = await this.prisma.task.findFirst({
      where: { id: parentTaskId, workspaceId, projectId },
      select: { id: true },
    });

    if (!parent) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');

    const subtasks = await this.prisma.task.findMany({
      where: { parentTaskId, workspaceId, archivedAt: null },
      include: taskInclude,
      // The same tail the view uses, so an expanded row is ordered the way its
      // siblings are and two equal positions never swap between reads.
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

    const ids = subtasks.map((task) => task.id);
    const [completed, customFieldValues] = await Promise.all([
      this.completedSubtaskCounts(ids),
      this.customFieldValues(ids),
    ]);

    return subtasks.map((task) => ({
      ...toTaskDto(task, completed.get(task.id) ?? 0),
      customFieldValues: customFieldValues.get(task.id) ?? [],
    }));
  }

  /** Every custom field value for a page of tasks, grouped by task. */
  private async customFieldValues(
    taskIds: string[],
  ): Promise<Map<string, Record<string, unknown>[]>> {
    if (taskIds.length === 0) return new Map();

    const rows = await this.prisma.taskCustomFieldValue.findMany({
      where: { taskId: { in: taskIds } },
    });

    const grouped = new Map<string, Record<string, unknown>[]>();

    for (const row of rows) {
      const value = {
        customFieldId: row.customFieldId,
        text: row.textValue,
        // Decimal keeps precision in PostgreSQL; JSON has no such type, and the
        // range is far inside what a double represents exactly.
        number: row.numberValue === null ? null : Number(row.numberValue),
        date: row.dateValue?.toISOString() ?? null,
        checkbox: row.booleanValue,
        optionIds: row.optionIds,
        userIds: row.userIds,
      };

      const bucket = grouped.get(row.taskId);
      if (bucket) bucket.push(value);
      else grouped.set(row.taskId, [value]);
    }

    return grouped;
  }

  async getDetail(workspaceId: string, taskId: string): Promise<TaskDetail> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId },
      include: taskDetailInclude,
    });

    if (!task) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');
    }

    return toTaskDetailDto(task);
  }

  async create(workspaceId: string, userId: string, dto: CreateTaskDto): Promise<Task> {
    const placement = await this.resolvePlacement(workspaceId, dto);
    await this.assertAssigneeIsMember(workspaceId, dto.assigneeId);

    const parent = dto.parentTaskId ? await this.requireTask(workspaceId, dto.parentTaskId) : null;

    if (parent?.parentTaskId) {
      // One level of nesting. Deeper trees need a different UI and a recursive
      // rollup; allowing them silently would produce tasks nothing renders.
      throw AppException.badRequest('BAD_REQUEST', 'A subtask cannot have its own subtasks.');
    }

    const siblings = await this.siblings(
      workspaceId,
      placement.sectionId,
      placement.projectId,
      dto.parentTaskId ?? null,
    );

    if (dto.afterTaskId) {
      this.assertSibling(siblings, dto.afterTaskId);
    }

    const plan = planPlacement(siblings, dto.afterTaskId);
    const status = dto.status ?? TaskStatus.TODO;

    const created = await this.prisma.$transaction(async (tx) => {
      await this.applyRebalance(tx, plan.rebalance);

      return tx.task.create({
        data: {
          workspaceId,
          projectId: placement.projectId,
          sectionId: placement.sectionId,
          parentTaskId: dto.parentTaskId ?? null,
          title: dto.title,
          description: dto.description ?? null,
          status,
          ...(dto.priority ? { priority: dto.priority } : {}),
          position: plan.position,
          assigneeId: dto.assigneeId ?? null,
          createdById: userId,
          startDate: toDate(dto.startDate),
          dueDate: toDate(dto.dueDate),
          completedAt: status === TaskStatus.DONE ? new Date() : null,
          estimatedMinutes: dto.estimatedMinutes ?? null,
        },
        include: taskInclude,
      });
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.TASK,
      entityId: created.id,
      summary: `Created task "${created.title}"`,
      metadata: { projectId: created.projectId, sectionId: created.sectionId },
    });

    const task = toTaskDto(created);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_CREATED, task);

    if (created.projectId) {
      await this.automation.publish({
        workspaceId,
        projectId: created.projectId,
        trigger: AutomationTrigger.TASK_CREATED,
        entityType: 'TASK',
        entityId: created.id,
        actorId: userId,
        after: { title: created.title, sectionId: created.sectionId },
      });
    }

    await this.notifyAssignment(workspaceId, userId, created, null);

    return task;
  }

  async update(
    workspaceId: string,
    userId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    const existing = await this.requireTask(workspaceId, taskId);
    await this.assertAssigneeIsMember(workspaceId, dto.assigneeId);

    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.startDate !== undefined) data.startDate = toDate(dto.startDate);
    if (dto.dueDate !== undefined) data.dueDate = toDate(dto.dueDate);
    if (dto.estimatedMinutes !== undefined) data.estimatedMinutes = dto.estimatedMinutes;
    if (dto.assigneeId !== undefined) {
      data.assignee = dto.assigneeId ? { connect: { id: dto.assigneeId } } : { disconnect: true };
    }

    if (dto.status !== undefined) {
      data.status = dto.status;
      // `completedAt` is derived from status rather than settable, so the two
      // can never disagree about whether the task is done.
      if (dto.status === TaskStatus.DONE && existing.completedAt === null) {
        data.completedAt = new Date();
      } else if (dto.status !== TaskStatus.DONE && existing.completedAt !== null) {
        data.completedAt = null;
      }
    }

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data,
      include: taskInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action:
        dto.status !== undefined && dto.status !== existing.status
          ? ActivityAction.STATUS_CHANGED
          : ActivityAction.UPDATED,
      entity: ActivityEntity.TASK,
      entityId: taskId,
      summary:
        dto.status !== undefined && dto.status !== existing.status
          ? `Moved "${updated.title}" to ${dto.status.replace(/_/g, ' ').toLowerCase()}`
          : `Updated task "${updated.title}"`,
      metadata: { fields: Object.keys(data) },
    });

    const task = await this.withSubtaskRollup(updated);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_UPDATED, task);

    /*
     * Announced after the write has landed, never before: a rule must react to
     * what is true, not to what is about to be attempted. Fire-and-forget,
     * because an automation failing to enqueue must not fail the edit.
     */
    if (updated.projectId) {
      const triggers: AutomationTrigger[] = [AutomationTrigger.TASK_UPDATED];
      if (existing.status !== updated.status) triggers.push(AutomationTrigger.TASK_STATUS_CHANGED);
      if (existing.priority !== updated.priority) {
        triggers.push(AutomationTrigger.TASK_PRIORITY_CHANGED);
      }
      if (existing.assigneeId !== updated.assigneeId && updated.assigneeId) {
        triggers.push(AutomationTrigger.TASK_ASSIGNED);
      }
      if (existing.completedAt === null && updated.completedAt !== null) {
        triggers.push(AutomationTrigger.TASK_COMPLETED);
      }

      for (const trigger of [...new Set(triggers)]) {
        await this.automation.publish({
          workspaceId,
          projectId: updated.projectId,
          trigger,
          entityType: 'TASK',
          entityId: updated.id,
          actorId: userId,
          before: {
            status: existing.status,
            priority: existing.priority,
            assigneeId: existing.assigneeId,
          },
          after: {
            status: updated.status,
            priority: updated.priority,
            assigneeId: updated.assigneeId,
          },
        });
      }
    }
    await this.notifyAssignment(workspaceId, userId, updated, existing.assigneeId);

    return task;
  }

  /** Moves a task within or between columns. */
  async move(workspaceId: string, userId: string, taskId: string, dto: MoveTaskDto): Promise<Task> {
    const existing = await this.requireTask(workspaceId, taskId);

    const section = dto.sectionId ? await this.requireSection(workspaceId, dto.sectionId) : null;

    // A task cannot sit in a column that belongs to a different project.
    if (section && existing.projectId && section.projectId !== existing.projectId) {
      throw AppException.badRequest('BAD_REQUEST', 'That section belongs to a different project.');
    }

    const projectId = section?.projectId ?? existing.projectId;
    const siblings = await this.siblings(
      workspaceId,
      dto.sectionId,
      projectId,
      existing.parentTaskId,
    );

    if (dto.afterTaskId) {
      this.assertSibling(siblings, dto.afterTaskId);
    }

    const plan = planPlacement(siblings, dto.afterTaskId, taskId);

    const updated = await this.prisma.$transaction(async (tx) => {
      await this.applyRebalance(tx, plan.rebalance);

      return tx.task.update({
        where: { id: taskId },
        data: { sectionId: dto.sectionId, projectId, position: plan.position },
        include: taskInclude,
      });
    });

    if (existing.sectionId !== dto.sectionId) {
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.UPDATED,
        entity: ActivityEntity.TASK,
        entityId: taskId,
        summary: `Moved "${updated.title}" to ${section?.name ?? 'no section'}`,
        metadata: { from: existing.sectionId, to: dto.sectionId },
      });
    }

    const task = await this.withSubtaskRollup(updated);

    if (updated.projectId) {
      await this.automation.publish({
        workspaceId,
        projectId: updated.projectId,
        trigger: AutomationTrigger.TASK_MOVED_TO_SECTION,
        entityType: 'TASK',
        entityId: updated.id,
        actorId: userId,
        before: { sectionId: existing.sectionId },
        after: { sectionId: updated.sectionId },
      });
    }

    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_MOVED, {
      task,
      fromSectionId: existing.sectionId,
    });

    return task;
  }

  /**
   * Archives rather than deletes: activity, comments and subtasks keep
   * referring to the task, and archiving is reversible.
   */
  async archive(workspaceId: string, userId: string, taskId: string): Promise<Task> {
    const existing = await this.requireTask(workspaceId, taskId);

    if (existing.archivedAt !== null) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This task is already archived.');
    }

    const archivedAt = new Date();

    const updated = await this.prisma.$transaction(async (tx) => {
      // Archiving a parent takes its subtasks with it; leaving them visible
      // under a hidden parent would strand them.
      await tx.task.updateMany({
        where: { parentTaskId: taskId, archivedAt: null },
        data: { archivedAt },
      });

      return tx.task.update({
        where: { id: taskId },
        data: { archivedAt },
        include: taskInclude,
      });
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.ARCHIVED,
      entity: ActivityEntity.TASK,
      entityId: taskId,
      summary: `Archived task "${existing.title}"`,
    });

    const task = await this.withSubtaskRollup(updated);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_ARCHIVED, task);

    return task;
  }

  async restore(workspaceId: string, userId: string, taskId: string): Promise<Task> {
    const existing = await this.requireTask(workspaceId, taskId);

    if (existing.archivedAt === null) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This task is not archived.');
    }

    const updated = await this.prisma.task.update({
      where: { id: taskId },
      data: { archivedAt: null },
      include: taskInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.RESTORED,
      entity: ActivityEntity.TASK,
      entityId: taskId,
      summary: `Restored task "${existing.title}"`,
    });

    const task = await this.withSubtaskRollup(updated);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_UPDATED, task);

    return task;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private buildWhere(
    workspaceId: string,
    userId: string,
    query: TaskListQueryDto,
  ): Prisma.TaskWhereInput {
    // `me` saves the client a round trip to learn its own id, and means a
    // shared "my tasks" link resolves per viewer.
    const assigneeId = query.assigneeId === 'me' ? userId : query.assigneeId;

    return {
      workspaceId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
      ...(query.includeSubtasks ? {} : { parentTaskId: null }),
      ...(query.projectId ? { projectId: query.projectId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(assigneeId ? { assigneeId } : {}),
      ...(query.status?.length ? { status: { in: query.status } } : {}),
      ...(query.priority?.length ? { priority: { in: query.priority } } : {}),
      ...(query.search ? { title: { contains: query.search, mode: 'insensitive' } } : {}),
      ...(query.dueBefore || query.dueAfter
        ? {
            dueDate: {
              ...(query.dueAfter ? { gte: new Date(query.dueAfter) } : {}),
              ...(query.dueBefore ? { lte: new Date(query.dueBefore) } : {}),
            },
          }
        : {}),
    };
  }

  /** Rollup over the whole filter, not just the current page. */
  private async summarize(where: Prisma.TaskWhereInput, total: number): Promise<TaskListSummary> {
    const [completed, overdue, unassigned] = await Promise.all([
      this.prisma.task.count({ where: { ...where, status: TaskStatus.DONE } }),
      this.prisma.task.count({
        where: {
          ...where,
          dueDate: { lt: new Date() },
          status: { notIn: [TaskStatus.DONE, TaskStatus.CANCELLED] },
        },
      }),
      this.prisma.task.count({ where: { ...where, assigneeId: null } }),
    ]);

    return { total, completed, overdue, unassigned };
  }

  /**
   * Resolves the project/section a new task belongs to.
   *
   * A section implies its project, so the client only has to supply one; when
   * both are given they must agree.
   */
  private async resolvePlacement(
    workspaceId: string,
    dto: CreateTaskDto,
  ): Promise<{ projectId: string | null; sectionId: string | null }> {
    if (!dto.sectionId) {
      if (dto.projectId) await this.requireProject(workspaceId, dto.projectId);
      return { projectId: dto.projectId ?? null, sectionId: null };
    }

    const section = await this.requireSection(workspaceId, dto.sectionId);

    if (dto.projectId && dto.projectId !== section.projectId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'The section does not belong to the given project.',
      );
    }

    return { projectId: section.projectId, sectionId: section.id };
  }

  /**
   * Tasks that share an ordering scope.
   *
   * Sectionless tasks are ordered per project (or across the workspace when
   * they have neither), and subtasks are ordered within their parent.
   */
  private siblings(
    workspaceId: string,
    sectionId: string | null | undefined,
    projectId: string | null,
    parentTaskId: string | null,
  ): Promise<OrderedItem[]> {
    return this.prisma.task.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        parentTaskId,
        ...(sectionId ? { sectionId } : { sectionId: null, projectId }),
      },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
  }

  private assertSibling(siblings: readonly OrderedItem[], afterTaskId: string): void {
    if (!siblings.some((sibling) => sibling.id === afterTaskId)) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'The task to position after is not in the same list.',
      );
    }
  }

  private async applyRebalance(
    tx: Prisma.TransactionClient,
    entries: readonly OrderedItem[],
  ): Promise<void> {
    for (const entry of entries) {
      await tx.task.update({ where: { id: entry.id }, data: { position: entry.position } });
    }
  }

  /**
   * Public so other modules can resolve a task without reimplementing the
   * workspace scoping — `CommentsService` uses it to attach a thread to a task
   * it has proven the caller can see.
   */
  async requireTask(workspaceId: string, taskId: string): Promise<PrismaTask> {
    const task = await this.prisma.task.findFirst({ where: { id: taskId, workspaceId } });

    if (!task) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');
    }

    return task;
  }

  private async requireSection(workspaceId: string, sectionId: string) {
    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, workspaceId },
      select: { id: true, name: true, projectId: true },
    });

    if (!section) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Section not found.');
    }

    return section;
  }

  private async requireProject(workspaceId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true },
    });

    if (!project) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
    }
  }

  private async assertAssigneeIsMember(
    workspaceId: string,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeId) return;

    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: assigneeId } },
      select: { id: true },
    });

    if (!membership) {
      throw AppException.badRequest('BAD_REQUEST', 'The assignee must be a workspace member.');
    }
  }

  /** Completed-subtask counts for a page of tasks, in one grouped query. */
  private async completedSubtaskCounts(taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();

    const rows = await this.prisma.task.groupBy({
      by: ['parentTaskId'],
      where: {
        parentTaskId: { in: taskIds },
        status: TaskStatus.DONE,
        archivedAt: null,
      },
      _count: { _all: true },
    });

    return new Map(
      rows
        .filter((row): row is typeof row & { parentTaskId: string } => row.parentTaskId !== null)
        .map((row) => [row.parentTaskId, row._count._all]),
    );
  }

  private async withSubtaskRollup(task: TaskWithRelations): Promise<Task> {
    const completed = await this.completedSubtaskCounts([task.id]);
    return toTaskDto(task, completed.get(task.id) ?? 0);
  }

  /** Tells someone they picked up work — but never notifies you about yourself. */
  private async notifyAssignment(
    workspaceId: string,
    actorId: string,
    task: PrismaTask,
    previousAssigneeId: string | null,
  ): Promise<void> {
    if (!task.assigneeId || task.assigneeId === previousAssigneeId) return;
    if (task.assigneeId === actorId) return;

    await this.notifications.dispatch({
      userId: task.assigneeId,
      workspaceId,
      type: NotificationType.TASK_ASSIGNED,
      title: 'You were assigned a task',
      body: task.title,
      entity: ActivityEntity.TASK,
      entityId: task.id,
      actionUrl: task.projectId ? `/projects/${task.projectId}` : '/my-tasks',
    });
  }
}

function toDate(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : new Date(value);
}
