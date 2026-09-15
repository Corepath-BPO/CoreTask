import {
  ActivityAction,
  ActivityEntity,
  AutomationTrigger,
  NotificationType,
  ServerEvent,
  TaskStatus,
  WorkspaceRole,
} from '@coretask/contracts';
import type {
  Task,
  TaskCustomFieldValue,
  TaskDetail,
  TaskListMeta,
  TaskListSummary,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Task as PrismaTask } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import {
  changedTaskFields,
  fieldChangeTriggers,
  taskFieldSnapshot,
} from '../automations/task-field-triggers';
import {
  compileFilters,
  compileSorts,
  type CustomFieldMap,
} from '../project-views/lib/query-compiler';
import { PaginatedResult, type ActorContext } from '../../common/types/api.types';
import { buildPaginationMeta, toSkipTake } from '../../common/utils/pagination.util';
import { planPlacement, type OrderedItem } from '../../common/utils/position.util';
import { normalizeRichText } from '../../common/utils/rich-text.util';
import {
  initialSchedule,
  resolveSchedule,
  startOfTodayUtc,
} from '../../common/utils/schedule.util';
import { PrismaService } from '../../database/prisma.service';
import { DescriptionMentionNotifier } from '../../integrations/notifications/description-mention.notifier';
import { FollowerNotifier } from '../../integrations/notifications/follower.notifier';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { ProjectBroadcastService } from '../../websocket/project-broadcast.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import {
  diffItemStories,
  snapshotFromTask,
  type SnapshotRefs,
} from '../activity-logs/item-stories';
import { toValueDto } from '../custom-fields/custom-field-value.mapper';
import { FormulaValuesService } from '../custom-fields/formula-values.service';
import { FollowersService } from '../followers/followers.service';
import { taskLink, taskRef } from '../followers/item-ref';
import { ProjectAccessService } from '../project-access/project-access.service';

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
    private readonly access: ProjectAccessService,
    private readonly broadcast: ProjectBroadcastService,
    private readonly automation: AutomationEventPublisher,
    private readonly notifications: NotificationDispatcher,
    private readonly mentions: DescriptionMentionNotifier,
    private readonly followers: FollowersService,
    private readonly followerNotifier: FollowerNotifier,
    private readonly formulas: FormulaValuesService,
  ) {}

  async list(
    workspaceId: string,
    actor: ActorContext,
    query: TaskListQueryDto,
  ): Promise<PaginatedResult<Task, TaskListMeta>> {
    const where = this.buildWhere(workspaceId, actor, query);

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

    // Formula values last, from the stored rows just read: worked out per
    // page and never stored, so they are always right.
    const rows = await this.formulas.decorateTasks(
      projectId,
      tasks.map((task) => ({
        ...toTaskDto(task, completed.get(task.id) ?? 0),
        customFieldValues: customFieldValues.get(task.id) ?? [],
      })),
    );

    return new PaginatedResult(rows, { ...buildPaginationMeta(query, total), summary });
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

    return this.formulas.decorateTasks(
      projectId,
      subtasks.map((task) => ({
        ...toTaskDto(task, completed.get(task.id) ?? 0),
        customFieldValues: customFieldValues.get(task.id) ?? [],
      })),
    );
  }

  /** Every stored custom field value for a page of tasks, grouped by task. */
  private async customFieldValues(taskIds: string[]): Promise<Map<string, TaskCustomFieldValue[]>> {
    if (taskIds.length === 0) return new Map();

    const rows = await this.prisma.taskCustomFieldValue.findMany({
      where: { taskId: { in: taskIds } },
    });

    const grouped = new Map<string, TaskCustomFieldValue[]>();

    for (const row of rows) {
      const value = toValueDto(row);

      const bucket = grouped.get(row.taskId);
      if (bucket) bucket.push(value);
      else grouped.set(row.taskId, [value]);
    }

    return grouped;
  }

  async getDetail(workspaceId: string, taskId: string, actor: ActorContext): Promise<TaskDetail> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, AND: [this.access.scopedWhere(actor)] },
      include: taskDetailInclude,
    });

    if (!task) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');
    }

    return toTaskDetailDto(task);
  }

  /**
   * The subtasks of one task, by the parent's id alone.
   *
   * The list view has its own route under the project (`listSubtasksForView`),
   * shaped for its cells. This one is for callers that hold nothing but a task
   * id — an n8n flow that created a task and wants to tick its children off one
   * by one — so it asks for no project and speaks the plain task shape the rest
   * of `/tasks` does. The parent is checked against the workspace first, for
   * the same reason as there: the guard proves the caller's membership, never
   * that the id in the path is theirs.
   */
  async listSubtasks(
    workspaceId: string,
    parentTaskId: string,
    actor: ActorContext,
  ): Promise<Task[]> {
    await this.requireTask(workspaceId, parentTaskId, actor);

    const subtasks = await this.prisma.task.findMany({
      where: { parentTaskId, workspaceId, archivedAt: null },
      include: taskInclude,
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });

    // Nesting stops at one level, so a subtask's own completed count is always 0.
    return subtasks.map((subtask) => toTaskDto(subtask));
  }

  async create(workspaceId: string, actor: ActorContext, dto: CreateTaskDto): Promise<Task> {
    const { userId } = actor;
    const placement = await this.resolvePlacement(workspaceId, actor, dto);
    await this.assertAssigneeIsMember(workspaceId, dto.assigneeId);
    await this.assertAssigneeCanSee(workspaceId, placement.projectId, dto.assigneeId);

    const parent = dto.parentTaskId
      ? await this.requireTask(workspaceId, dto.parentTaskId, actor, WorkspaceRole.MEMBER)
      : null;

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
    const start = initialSchedule({ date: dto.startDate, at: dto.startAt }, 'start');
    const due = initialSchedule({ date: dto.dueDate, at: dto.dueAt }, 'due');

    const created = await this.prisma.$transaction(async (tx) => {
      await this.applyRebalance(tx, plan.rebalance);

      return tx.task.create({
        data: {
          workspaceId,
          projectId: placement.projectId,
          sectionId: placement.sectionId,
          parentTaskId: dto.parentTaskId ?? null,
          title: dto.title,
          description: normalizeRichText(dto.description) ?? null,
          status,
          ...(dto.priority ? { priority: dto.priority } : {}),
          position: plan.position,
          assigneeId: dto.assigneeId ?? null,
          createdById: userId,
          startDate: start.date,
          startAt: start.at,
          dueDate: due.date,
          dueAt: due.at,
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
      projectId: created.projectId,
      summary: `Created task "${created.title}"`,
      metadata: { projectId: created.projectId, sectionId: created.sectionId },
    });

    // The parent's feed says a subtask arrived; the subtask's own line above
    // says it was created. Two readers, two lines.
    if (parent) {
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.SUBTASK_ADDED,
        entity: ActivityEntity.TASK,
        entityId: parent.id,
        projectId: parent.projectId,
        summary: `Added subtask “${created.title}”`,
        metadata: { subtaskId: created.id, title: created.title },
      });
    }

    const task = toTaskDto(created);
    void this.broadcast.emit(workspaceId, created.projectId, ServerEvent.TASK_CREATED, task);

    // The creator and the assignee follow from the start, as in Asana.
    await this.followers.ensure(workspaceId, taskLink(created.id), [userId, created.assigneeId]);

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
    await this.mentions.notify({
      workspaceId,
      actorId: userId,
      entity: 'TASK',
      entityId: created.id,
      projectId: created.projectId,
      label: `“${created.title}”`,
      actionUrl: `/my-tasks?task=${created.id}`,
      before: null,
      after: created.description,
    });

    return task;
  }

  async update(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<Task> {
    const { userId } = actor;
    const existing = await this.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    await this.assertAssigneeIsMember(workspaceId, dto.assigneeId);
    await this.assertAssigneeCanSee(workspaceId, existing.projectId, dto.assigneeId);

    const data: Prisma.TaskUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = normalizeRichText(dto.description);
    if (dto.priority !== undefined) data.priority = dto.priority;
    if (dto.estimatedMinutes !== undefined) data.estimatedMinutes = dto.estimatedMinutes;

    // The date and its time move as a pair — see `resolveSchedule`.
    const start = resolveSchedule(
      { date: existing.startDate, at: existing.startAt },
      { date: dto.startDate, at: dto.startAt },
      'start',
    );
    if (start.date !== undefined) data.startDate = start.date;
    if (start.at !== undefined) data.startAt = start.at;

    const due = resolveSchedule(
      { date: existing.dueDate, at: existing.dueAt },
      { date: dto.dueDate, at: dto.dueAt },
      'due',
    );
    if (due.date !== undefined) data.dueDate = due.date;
    if (due.at !== undefined) data.dueAt = due.at;
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

    /*
     * One story per property that moved, so the panel reads "changed the due
     * date from Sep 1 to Sep 12" rather than "updated task". An edit the diff
     * cannot describe — the estimate, say — still leaves the plain line.
     */
    const stories = diffItemStories(
      snapshotFromTask(existing, await this.refsFor(existing.assigneeId, updated.assignee)),
      snapshotFromTask(updated, { assignee: this.assigneeRef(updated.assignee) }),
      'task',
    );
    const context = {
      workspaceId,
      actorId: userId,
      entity: ActivityEntity.TASK,
      entityId: taskId,
      projectId: updated.projectId,
    };
    if (stories.length > 0) {
      await this.activity.recordStories(context, stories);
    } else {
      await this.activity.record({
        ...context,
        action: ActivityAction.UPDATED,
        summary: `Updated task "${updated.title}"`,
        metadata: { fields: Object.keys(data) },
      });
    }

    const task = await this.withSubtaskRollup(updated);
    void this.broadcast.emit(workspaceId, updated.projectId, ServerEvent.TASK_UPDATED, task);

    if (updated.assigneeId && updated.assigneeId !== existing.assigneeId) {
      await this.followers.ensure(workspaceId, taskLink(updated.id), [updated.assigneeId]);
    }
    await this.followerNotifier.notifyStories(taskRef(workspaceId, updated), userId, stories);

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
      // The fields a rule can watch on their own — the same derivation the
      // list view's edits and a rule's own writes use.
      triggers.push(...fieldChangeTriggers(changedTaskFields(existing, updated)));

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
            ...taskFieldSnapshot(existing),
          },
          after: {
            status: updated.status,
            priority: updated.priority,
            assigneeId: updated.assigneeId,
            ...taskFieldSnapshot(updated),
          },
        });
      }
    }
    await this.notifyAssignment(workspaceId, userId, updated, existing.assigneeId);
    if (dto.description !== undefined) {
      await this.mentions.notify({
        workspaceId,
        actorId: userId,
        entity: 'TASK',
        entityId: updated.id,
        projectId: updated.projectId,
        label: `“${updated.title}”`,
        actionUrl: `/my-tasks?task=${updated.id}`,
        before: existing.description,
        after: updated.description,
      });
    }

    return task;
  }

  /** Moves a task within or between columns. */
  async move(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    dto: MoveTaskDto,
  ): Promise<Task> {
    const { userId } = actor;
    const existing = await this.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);

    const section = dto.sectionId ? await this.requireSection(workspaceId, dto.sectionId) : null;

    // A task cannot sit in a column that belongs to a different project.
    if (section && existing.projectId && section.projectId !== existing.projectId) {
      throw AppException.badRequest('BAD_REQUEST', 'That section belongs to a different project.');
    }

    // A workspace-level task joining a project's column is a write into that
    // project, which the caller must be allowed to make.
    if (section && !existing.projectId) {
      await this.access.requireAccess(workspaceId, section.projectId, actor, WorkspaceRole.MEMBER);
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
      const from = existing.sectionId
        ? await this.prisma.section.findUnique({
            where: { id: existing.sectionId },
            select: { id: true, name: true },
          })
        : null;

      await this.activity.recordStories(
        {
          workspaceId,
          actorId: userId,
          entity: ActivityEntity.TASK,
          entityId: taskId,
          projectId: updated.projectId,
        },
        diffItemStories(
          snapshotFromTask(existing, { section: from ? { id: from.id, label: from.name } : null }),
          snapshotFromTask(updated, {
            section: section ? { id: section.id, label: section.name } : null,
          }),
          'task',
        ),
      );
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

    void this.broadcast.emit(workspaceId, updated.projectId, ServerEvent.TASK_MOVED, {
      task,
      fromSectionId: existing.sectionId,
    });

    return task;
  }

  /**
   * Archives rather than deletes: activity, comments and subtasks keep
   * referring to the task, and archiving is reversible.
   */
  async archive(workspaceId: string, actor: ActorContext, taskId: string): Promise<Task> {
    const { userId } = actor;
    const existing = await this.requireTask(workspaceId, taskId, actor, WorkspaceRole.MANAGER);

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
      projectId: existing.projectId,
      summary: `Archived task "${existing.title}"`,
    });

    const task = await this.withSubtaskRollup(updated);
    void this.broadcast.emit(workspaceId, updated.projectId, ServerEvent.TASK_ARCHIVED, task);

    return task;
  }

  async restore(workspaceId: string, actor: ActorContext, taskId: string): Promise<Task> {
    const { userId } = actor;
    const existing = await this.requireTask(workspaceId, taskId, actor, WorkspaceRole.MANAGER);

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
      projectId: existing.projectId,
      summary: `Restored task "${existing.title}"`,
    });

    const task = await this.withSubtaskRollup(updated);
    void this.broadcast.emit(workspaceId, updated.projectId, ServerEvent.TASK_UPDATED, task);

    return task;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private buildWhere(
    workspaceId: string,
    actor: ActorContext,
    query: TaskListQueryDto,
  ): Prisma.TaskWhereInput {
    // `me` saves the client a round trip to learn its own id, and means a
    // shared "my tasks" link resolves per viewer.
    const assigneeId = query.assigneeId === 'me' ? actor.userId : query.assigneeId;

    return {
      workspaceId,
      // Under AND: `summarize` spreads this where and sets its own OR on top.
      AND: [this.access.scopedWhere(actor)],
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
    const now = new Date();
    const [completed, overdue, unassigned] = await Promise.all([
      this.prisma.task.count({ where: { ...where, status: TaskStatus.DONE } }),
      this.prisma.task.count({
        where: {
          ...where,
          /*
           * A task with a time is late the moment that instant passes; one
           * without is late only once its calendar day is over. Comparing the
           * date column against "now" made a task due today overdue from a
           * minute past midnight UTC.
           */
          OR: [{ dueAt: { lt: now } }, { dueAt: null, dueDate: { lt: startOfTodayUtc(now) } }],
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
    actor: ActorContext,
    dto: CreateTaskDto,
  ): Promise<{ projectId: string | null; sectionId: string | null }> {
    // The project arrives in the body, where `ProjectAccessGuard` cannot see
    // it, so the check happens here: invisible is a 404, visible but read-only
    // is a 403.
    if (!dto.sectionId) {
      if (dto.projectId) {
        await this.access.requireAccess(workspaceId, dto.projectId, actor, WorkspaceRole.MEMBER);
      }
      return { projectId: dto.projectId ?? null, sectionId: null };
    }

    const section = await this.requireSection(workspaceId, dto.sectionId);

    if (dto.projectId && dto.projectId !== section.projectId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'The section does not belong to the given project.',
      );
    }

    await this.access.requireAccess(workspaceId, section.projectId, actor, WorkspaceRole.MEMBER);

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
   *
   * "Can see" now includes the project's privacy: a task in a private project
   * the caller is not in does not exist for them. With `minimumRole`, it also
   * checks the caller acts with at least that role in the task's project.
   */
  async requireTask(
    workspaceId: string,
    taskId: string,
    actor: ActorContext,
    minimumRole?: WorkspaceRole,
  ): Promise<PrismaTask> {
    const task = await this.prisma.task.findFirst({
      where: { id: taskId, workspaceId, AND: [this.access.scopedWhere(actor)] },
    });

    if (!task) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task not found.');
    }

    if (minimumRole) {
      await this.access.assertEffectiveRole(task.projectId, actor, minimumRole);
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

  private assigneeRef(
    assignee: { id: string; name: string } | null,
  ): { id: string; label: string } | null {
    return assignee ? { id: assignee.id, label: assignee.name } : null;
  }

  /**
   * The previous assignee as a story ref. The row before the write carries
   * only the id, so the name is looked up — unless it is the same person the
   * write left in place, whose name is already in hand.
   */
  private async refsFor(
    previousAssigneeId: string | null,
    current: { id: string; name: string } | null,
  ): Promise<SnapshotRefs> {
    if (!previousAssigneeId) return { assignee: null };
    if (current && current.id === previousAssigneeId) {
      return { assignee: this.assigneeRef(current) };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: previousAssigneeId },
      select: { id: true, name: true },
    });

    return {
      assignee: user ? this.assigneeRef(user) : { id: previousAssigneeId, label: 'Someone' },
    };
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

  /** Assigning work someone cannot open helps nobody: they would get a notification to a 404. */
  private async assertAssigneeCanSee(
    workspaceId: string,
    projectId: string | null,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (!assigneeId) return;

    await this.access.assertUsersCanSee(
      workspaceId,
      projectId,
      [assigneeId],
      'The assignee must be able to see this project.',
    );
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
