import {
  AutomationTrigger,
  CREATABLE_WORK_ITEM_TYPES,
  ServerEvent,
  WorkItemType,
  type WorkItemEventPayload,
} from '@coretask/contracts';
import type {
  BulkWorkItemPayload,
  CreateWorkItemPayload,
  MoveWorkItemPayload,
  ProjectWorkItem,
  ProjectWorkItemPage,
  ProjectWorkItemQuery,
  UpdateWorkItemPayload,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import {
  ActivityAction,
  ActivityEntity,
  Prisma,
  TicketPriority,
  TicketStatus,
} from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { planPlacement } from '../../common/utils/position.util';
import { PrismaService } from '../../database/prisma.service';
import { DescriptionMentionNotifier } from '../../integrations/notifications/description-mention.notifier';
import { FollowerNotifier } from '../../integrations/notifications/follower.notifier';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { diffItemStories, snapshotFromWorkItem } from '../activity-logs/item-stories';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import { fieldChangeTriggers } from '../automations/task-field-triggers';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { FormulaValuesService } from '../custom-fields/formula-values.service';
import { FollowersService } from '../followers/followers.service';
import { taskLink, taskRef, ticketLink, ticketRef, type ItemRef } from '../followers/item-ref';
import { FieldMetadataService } from '../project-views/field-metadata.service';
import { compileOrder } from '../project-views/lib/order-compiler';
import {
  compileFilters,
  compileTicketFilters,
  type CustomFieldMap,
} from '../project-views/lib/query-compiler';
import { ProjectsService } from '../projects/projects.service';

import {
  compareWorkItems,
  taskToWorkItem,
  ticketToWorkItem,
  workItemTaskInclude,
  workItemTicketInclude,
} from './lib/work-item.mapper';
import { TaskWorkItemRepository } from './repositories/task-work-item.repository';
import { TicketWorkItemRepository } from './repositories/ticket-work-item.repository';
import { WorkItemOrderRepository } from './repositories/work-item-order.repository';

/**
 * One way in and out of a project's work items, whatever backs them.
 *
 * The List and the Board used to each own their read query, their create call
 * and their move call, against different endpoints, so the same act produced
 * different results depending on which screen you were looking at. Everything
 * routes through here now: both views call the same methods, so there is one
 * place where placement, authorization, activity and events are decided, and
 * no way for the two to drift.
 *
 * The repositories below know which table to write. This service knows nothing
 * about Prisma models beyond delegating — deliberately, because the moment it
 * starts special-casing tasks the abstraction stops being worth having.
 */
@Injectable()
export class ProjectWorkItemService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly tasks: TaskWorkItemRepository,
    private readonly tickets: TicketWorkItemRepository,
    private readonly activity: ActivityLogsService,
    private readonly automation: AutomationEventPublisher,
    private readonly realtime: RealtimeGateway,
    private readonly mentions: DescriptionMentionNotifier,
    private readonly followers: FollowersService,
    private readonly followerNotifier: FollowerNotifier,
    private readonly customFields: CustomFieldsService,
    private readonly formulas: FormulaValuesService,
    private readonly fieldMetadata: FieldMetadataService,
    private readonly order: WorkItemOrderRepository,
  ) {}

  /**
   * Everything in the project, both kinds, in one ordering.
   *
   * A single pass rather than "tasks then tickets": they share a section's
   * position space, so a board column has to interleave them by position. Two
   * separate lists concatenated would put every ticket after every task no
   * matter where somebody dragged it.
   */
  async list(
    workspaceId: string,
    projectId: string,
    query: ProjectWorkItemQuery = {},
  ): Promise<ProjectWorkItemPage> {
    await this.projects.requireProject(workspaceId, projectId);

    const types = query.types ?? CREATABLE_WORK_ITEM_TYPES;
    const wantsTasks = types.includes(WorkItemType.TASK);
    const wantsTickets = types.includes(WorkItemType.TICKET);

    /*
     * The view's settings, compiled once for both kinds. The field map is
     * read only when something refers to a field, so the plain read — no
     * filter, no sort — costs exactly what it always did.
     */
    const conditions = query.filters ?? [];
    const wantsFields =
      conditions.length > 0 || Boolean(query.sorts?.length) || Boolean(query.groupBy);
    const customFields = wantsFields
      ? await this.fieldMetadata.customFieldMap(workspaceId, projectId)
      : new Map();
    const taskFilters = compileFilters(conditions, customFields);
    const ticketFilters = compileTicketFilters(conditions, customFields);

    if (query.sorts?.length || query.groupBy) {
      return this.listOrdered(workspaceId, projectId, query, {
        wantsTasks,
        wantsTickets,
        customFields,
        taskFilters,
        ticketFilters,
      });
    }

    const [tasks, tickets] = await Promise.all([
      wantsTasks
        ? this.tasks.list(workspaceId, projectId, query, taskFilters)
        : Promise.resolve([]),
      wantsTickets
        ? this.tickets.list(workspaceId, projectId, query, ticketFilters)
        : Promise.resolve([]),
    ]);

    const items = [...tasks.map(taskToWorkItem), ...tickets.map(ticketToWorkItem)].sort(
      compareWorkItems,
    );

    /*
     * Paged after merging, not before.
     *
     * Each repository is capped so one kind cannot exhaust the budget, but the
     * page boundary has to be decided on the merged order — slicing each list
     * to `limit` first would drop items that sort into the middle.
     */
    const limit = query.limit ?? 200;
    // Formula values are worked out for the page that is going out, not for
    // every row that was read.
    const page = await this.formulas.decorateWorkItems(projectId, items.slice(0, limit));

    return {
      items: page,
      nextCursor: items.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  /**
   * The ordered read: a sort, or a group key, that both kinds must obey at
   * once.
   *
   * Two id allowlists from Prisma, one raw ordering over them, one hydration
   * per kind in the order the database gave. The default path above is
   * untouched, so a view with no sort reads exactly as it always has.
   */
  private async listOrdered(
    workspaceId: string,
    projectId: string,
    query: ProjectWorkItemQuery,
    scope: {
      wantsTasks: boolean;
      wantsTickets: boolean;
      customFields: CustomFieldMap;
      taskFilters: Prisma.TaskWhereInput[];
      ticketFilters: Prisma.TicketWhereInput[] | 'NONE';
    },
  ): Promise<ProjectWorkItemPage> {
    const plan = compileOrder(query.sorts ?? [], query.groupBy ?? null, scope.customFields);

    const [taskIds, ticketIds] = await Promise.all([
      scope.wantsTasks
        ? this.tasks.listIds(workspaceId, projectId, query, scope.taskFilters)
        : Promise.resolve([]),
      scope.wantsTickets
        ? this.tickets.listIds(workspaceId, projectId, query, scope.ticketFilters)
        : Promise.resolve([]),
    ]);

    const limit = query.limit ?? 200;
    const ordered = await this.order.orderIds(taskIds, ticketIds, plan, limit + 1);
    const page = ordered.slice(0, limit);

    const [tasks, tickets] = await Promise.all([
      this.tasks.hydrate(page.filter((row) => row.kind === 'TASK').map((row) => row.id)),
      this.tickets.hydrate(page.filter((row) => row.kind === 'TICKET').map((row) => row.id)),
    ]);
    const byId = new Map<string, ProjectWorkItem>();
    for (const task of tasks) byId.set(task.id, taskToWorkItem(task));
    for (const ticket of tickets) byId.set(ticket.id, ticketToWorkItem(ticket));

    const items = page
      .map((row) => byId.get(row.id))
      .filter((item): item is ProjectWorkItem => item !== undefined);

    return {
      items: await this.formulas.decorateWorkItems(projectId, items),
      nextCursor: ordered.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async getById(
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<ProjectWorkItem> {
    await this.projects.requireProject(workspaceId, projectId);

    const item = await this.find(workspaceId, projectId, workItemId);
    if (!item) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Work item not found.');
    }

    return this.withFormulas(projectId, item);
  }

  /** One item with its formula values, the shape every single-item response takes. */
  private async withFormulas(projectId: string, item: ProjectWorkItem): Promise<ProjectWorkItem> {
    const [decorated] = await this.formulas.decorateWorkItems(projectId, [item]);
    return decorated ?? item;
  }

  async create(
    workspaceId: string,
    projectId: string,
    userId: string,
    payload: CreateWorkItemPayload,
  ): Promise<ProjectWorkItem> {
    await this.projects.requireProject(workspaceId, projectId);

    /*
     * Refused here as well as in the schema.
     *
     * The picker disables Milestone and Approval, but a disabled control is
     * presentation. Without this an unimplemented type would be written as
     * whichever record the service defaulted to, wearing a label that lies
     * about what it is.
     */
    if (!CREATABLE_WORK_ITEM_TYPES.includes(payload.type)) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `${payload.type} cannot be created yet. Supported: ${CREATABLE_WORK_ITEM_TYPES.join(', ')}.`,
      );
    }

    const sectionId = await this.resolveSection(projectId, payload.sectionId);
    const position = await this.nextPosition(workspaceId, projectId, sectionId, payload.afterId);

    const created =
      payload.type === WorkItemType.TICKET
        ? await this.tickets.create(workspaceId, projectId, userId, payload, sectionId, position)
        : await this.tasks.create(workspaceId, projectId, userId, payload, sectionId, position);

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.CREATED,
      entity: created.type === WorkItemType.TICKET ? ActivityEntity.TICKET : ActivityEntity.TASK,
      entityId: created.id,
      summary: this.describe(created, 'Created'),
      metadata: {
        projectId,
        sectionId: created.sectionId,
        workItemType: created.type,
        source: 'USER',
      },
    });

    if (created.parentId) {
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.SUBTASK_ADDED,
        entity: ActivityEntity.TASK,
        entityId: created.parentId,
        summary: `Added subtask “${created.title}”`,
        metadata: { subtaskId: created.id, title: created.title },
      });
    }

    await this.automation.publish({
      workspaceId,
      projectId,
      trigger:
        created.type === WorkItemType.TICKET
          ? AutomationTrigger.TICKET_CREATED
          : AutomationTrigger.TASK_CREATED,
      entityType: created.type === WorkItemType.TICKET ? 'TICKET' : 'TASK',
      entityId: created.id,
      actorId: userId,
      after: { title: created.title, sectionId: created.sectionId },
      ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
    });

    this.emit(ServerEvent.WORK_ITEM_CREATED, created, userId, {
      ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
    });

    await this.followers.ensure(workspaceId, this.linkOf(created), [
      userId,
      ...created.assignees.map((assignee) => assignee.id),
    ]);

    await this.mentions.notify({
      ...this.mentionTarget(created, userId),
      before: null,
      after: created.description,
    });

    /*
     * The old events still fire.
     *
     * Anything already listening for `task:created` — the board, another tab, a
     * future integration — keeps working while callers move across. Removing
     * them is a separate decision, made once nothing depends on them.
     */
    this.realtime.emitToWorkspace(
      workspaceId,
      created.type === WorkItemType.TICKET ? ServerEvent.TICKET_CREATED : ServerEvent.TASK_CREATED,
      created,
    );

    return created;
  }

  async update(
    workspaceId: string,
    projectId: string,
    userId: string,
    workItemId: string,
    payload: UpdateWorkItemPayload,
  ): Promise<ProjectWorkItem> {
    const before = await this.getById(workspaceId, projectId, workItemId);

    const updated =
      before.type === WorkItemType.TICKET
        ? await this.tickets.update(workspaceId, workItemId, payload)
        : await this.tasks.update(workspaceId, workItemId, payload);

    const changedFields = this.changedFields(before, updated);
    if (changedFields.length === 0) return this.withFormulas(projectId, updated);

    const itemWord = updated.type === WorkItemType.TICKET ? 'ticket' : 'task';
    const stories = diffItemStories(
      snapshotFromWorkItem(before),
      snapshotFromWorkItem(updated),
      itemWord,
    );
    const context = {
      workspaceId,
      actorId: userId,
      entity: updated.type === WorkItemType.TICKET ? ActivityEntity.TICKET : ActivityEntity.TASK,
      entityId: updated.id,
    };
    if (stories.length > 0) {
      await this.activity.recordStories(context, stories);
    } else {
      await this.activity.record({
        ...context,
        action: ActivityAction.UPDATED,
        summary: this.describe(updated, 'Updated'),
        metadata: { projectId, workItemType: updated.type, changedFields, source: 'USER' },
      });
    }

    for (const trigger of this.triggersFor(before, updated, changedFields)) {
      await this.automation.publish({
        workspaceId,
        projectId,
        trigger,
        entityType: updated.type === WorkItemType.TICKET ? 'TICKET' : 'TASK',
        entityId: updated.id,
        actorId: userId,
        before: {
          status: before.status?.id,
          priority: before.priority?.id,
          title: before.title,
          dueDate: before.dueDate,
          startDate: before.startDate,
          estimatedMinutes: estimateOf(before),
        },
        after: {
          status: updated.status?.id,
          priority: updated.priority?.id,
          title: updated.title,
          dueDate: updated.dueDate,
          startDate: updated.startDate,
          estimatedMinutes: estimateOf(updated),
        },
        ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
      });
    }

    this.emit(ServerEvent.WORK_ITEM_UPDATED, updated, userId, {
      changedFields,
      ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
    });

    if (changedFields.includes('assignees')) {
      await this.followers.ensure(
        workspaceId,
        this.linkOf(updated),
        updated.assignees.map((assignee) => assignee.id),
      );
    }
    await this.followerNotifier.notifyStories(this.refOf(updated), userId, stories);

    if (changedFields.includes('description')) {
      await this.mentions.notify({
        ...this.mentionTarget(updated, userId),
        before: before.description,
        after: updated.description,
      });
    }

    this.realtime.emitToWorkspace(
      workspaceId,
      updated.type === WorkItemType.TICKET ? ServerEvent.TICKET_UPDATED : ServerEvent.TASK_UPDATED,
      updated,
    );

    return this.withFormulas(projectId, updated);
  }

  /**
   * Moving between sections, which is what a board drag is.
   *
   * Both kinds land in the same position space, so the sibling list that decides
   * the new position has to contain both. Computing it from tasks alone is how a
   * ticket ends up sharing a position with a task and the column order becomes a
   * coin toss.
   */
  async move(
    workspaceId: string,
    projectId: string,
    userId: string,
    workItemId: string,
    payload: MoveWorkItemPayload,
  ): Promise<ProjectWorkItem> {
    const before = await this.getById(workspaceId, projectId, workItemId);
    const sectionId = await this.resolveSection(projectId, payload.targetSectionId, true);

    const siblings = await this.siblingPositions(workspaceId, projectId, sectionId);
    const anchor = this.resolveAnchor(siblings, payload);

    const plan = planPlacement(siblings, anchor, workItemId);

    const moved =
      before.type === WorkItemType.TICKET
        ? await this.tickets.move(workspaceId, workItemId, sectionId, plan.position)
        : await this.tasks.move(workspaceId, workItemId, sectionId, plan.position);

    /*
     * A section story, with both names, when the column changed. A drag that
     * only reordered within the column is not a story anyone reads — Asana
     * shows nothing for it either — but it stays in the audit trail as before.
     */
    const entity = moved.type === WorkItemType.TICKET ? ActivityEntity.TICKET : ActivityEntity.TASK;
    if (before.sectionId !== moved.sectionId) {
      const sections = await this.prisma.section.findMany({
        where: {
          id: { in: [before.sectionId, moved.sectionId].filter((id): id is string => !!id) },
        },
        select: { id: true, name: true },
      });
      const ref = (id: string | null) => {
        const section = sections.find((row) => row.id === id);
        return section ? { id: section.id, label: section.name } : null;
      };

      await this.activity.recordStories(
        { workspaceId, actorId: userId, entity, entityId: moved.id },
        diffItemStories(
          snapshotFromWorkItem(before, { section: ref(before.sectionId) }),
          snapshotFromWorkItem(moved, { section: ref(moved.sectionId) }),
          moved.type === WorkItemType.TICKET ? 'ticket' : 'task',
        ),
      );
    } else {
      await this.activity.record({
        workspaceId,
        actorId: userId,
        action: ActivityAction.UPDATED,
        entity,
        entityId: moved.id,
        summary: this.describe(moved, 'Moved'),
        metadata: {
          projectId,
          workItemType: moved.type,
          fromSectionId: before.sectionId,
          toSectionId: moved.sectionId,
          source: 'USER',
        },
      });
    }

    if (before.sectionId !== moved.sectionId) {
      await this.automation.publish({
        workspaceId,
        projectId,
        trigger: AutomationTrigger.TASK_MOVED_TO_SECTION,
        entityType: moved.type === WorkItemType.TICKET ? 'TICKET' : 'TASK',
        entityId: moved.id,
        actorId: userId,
        before: { sectionId: before.sectionId },
        after: { sectionId: moved.sectionId },
        ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
      });
    }

    this.emit(ServerEvent.WORK_ITEM_MOVED, moved, userId, {
      fromSectionId: before.sectionId,
      toSectionId: moved.sectionId,
      ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
    });

    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_MOVED, {
      id: moved.id,
      sectionId: moved.sectionId,
      position: moved.position,
    });

    return this.withFormulas(projectId, moved);
  }

  /**
   * One change, applied to a selection.
   *
   * Each row goes through the same `update`, `move` and archive paths a single
   * edit takes, so the activity feed, the rules engine and every open tab see
   * twenty ordinary changes rather than one unfamiliar event — deliberately not
   * one transaction. What *is* checked up front is everything that could fail
   * part-way: every id has to be in this project, and a vocabulary a ticket
   * cannot hold is refused before the first task is written.
   *
   * The rows are handled in the order named, which is the order they were
   * selected on screen; a move appends, so they keep that order in the new
   * section.
   */
  async bulk(
    workspaceId: string,
    projectId: string,
    userId: string,
    payload: BulkWorkItemPayload,
  ): Promise<ProjectWorkItem[]> {
    await this.projects.requireProject(workspaceId, projectId);

    const items = await this.findMany(workspaceId, projectId, payload.workItemIds);
    const hasTicket = items.some((item) => item.type === WorkItemType.TICKET);

    if (hasTicket && payload.archived) {
      throw AppException.badRequest('BAD_REQUEST', 'Tickets cannot be archived from here.');
    }

    if (hasTicket && payload.update) {
      const { statusId, priorityId } = payload.update;
      if (statusId && !(statusId in TicketStatus)) {
        throw AppException.badRequest('BAD_REQUEST', 'That status does not apply to a ticket.');
      }
      if (priorityId && !(priorityId in TicketPriority)) {
        throw AppException.badRequest('BAD_REQUEST', 'That priority does not apply to a ticket.');
      }
    }

    const correlation = payload.correlationId ? { correlationId: payload.correlationId } : {};

    /*
     * Field values are split from the row update and checked before any row
     * is written: every field must be on this project and every value must
     * fit its field, or the edit fails whole rather than three rows in. Each
     * row then goes through `setValue` like a single cell edit, so it gets
     * the same story, the same rule trigger and the same realtime push.
     */
    const { customFieldValues, ...rowUpdate } = payload.update ?? {};
    const fieldValues = Object.entries(customFieldValues ?? {});
    const fields = await this.customFields.requireProjectFields(
      workspaceId,
      projectId,
      fieldValues.map(([fieldId]) => fieldId),
    );
    for (const [fieldId, value] of fieldValues) {
      const field = fields.get(fieldId);
      if (field) await this.customFields.validateValue(workspaceId, field, value);
    }

    const hasRowUpdate = Object.keys(rowUpdate).length > 0;
    const results: ProjectWorkItem[] = [];

    for (const item of items) {
      let current = item;

      if (hasRowUpdate) {
        current = await this.update(workspaceId, projectId, userId, item.id, {
          ...rowUpdate,
          ...correlation,
        });
      }

      // Tickets hold no custom-field values, so they are skipped rather than
      // refused: a mixed selection still gets its tasks changed.
      if (fieldValues.length > 0 && item.type === WorkItemType.TASK) {
        for (const [fieldId, value] of fieldValues) {
          await this.customFields.setValue(workspaceId, item.id, userId, fieldId, value, {
            source: 'BULK',
            correlationId: payload.correlationId,
          });
        }
        current = await this.getById(workspaceId, projectId, item.id);
      }

      if (payload.sectionId !== undefined) {
        current = await this.move(workspaceId, projectId, userId, item.id, {
          targetSectionId: payload.sectionId,
          ...correlation,
        });
      }

      if (payload.archived) {
        current = await this.archive(workspaceId, projectId, userId, current, correlation);
      }

      results.push(current);
    }

    return results;
  }

  // ---------------------------------------------------------------- internals

  /**
   * Archives one task through the shared layer.
   *
   * Tasks only — the caller has already refused tickets. Announced as an update
   * of `archivedAt` on the project room, which is what the List listens for,
   * and as the legacy `task:archived` on the workspace, which the board and
   * older listeners still expect.
   */
  private async archive(
    workspaceId: string,
    projectId: string,
    userId: string,
    before: ProjectWorkItem,
    correlation: { correlationId?: string },
  ): Promise<ProjectWorkItem> {
    if (before.archivedAt !== null) return before;

    const archived = await this.tasks.archive(workspaceId, before.id);

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.ARCHIVED,
      entity: ActivityEntity.TASK,
      entityId: archived.id,
      summary: this.describe(archived, 'Archived'),
      metadata: { projectId, workItemType: archived.type, source: 'USER' },
    });

    this.emit(ServerEvent.WORK_ITEM_UPDATED, archived, userId, {
      changedFields: ['archivedAt'],
      ...correlation,
    });
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.TASK_ARCHIVED, archived);

    return archived;
  }

  /**
   * Every named row, in the order named — or a 404 naming none of them.
   *
   * Checked before anything is written so a selection that strays into another
   * project (a stale tab, a forged id) changes nothing at all, rather than the
   * rows that happened to come first.
   */
  private async findMany(
    workspaceId: string,
    projectId: string,
    ids: string[],
  ): Promise<ProjectWorkItem[]> {
    const [tasks, tickets] = await Promise.all([
      this.prisma.task.findMany({
        where: { id: { in: ids }, workspaceId, projectId },
        include: workItemTaskInclude,
      }),
      this.prisma.ticket.findMany({
        where: { id: { in: ids }, workspaceId, projectId },
        include: workItemTicketInclude,
      }),
    ]);

    const byId = new Map<string, ProjectWorkItem>();
    for (const task of tasks) byId.set(task.id, taskToWorkItem(task));
    for (const ticket of tickets) byId.set(ticket.id, ticketToWorkItem(ticket));

    if (byId.size !== ids.length) {
      throw AppException.notFound(
        'RESOURCE_NOT_FOUND',
        'Some of those work items are not in this project.',
      );
    }

    return ids.map((id) => byId.get(id) as ProjectWorkItem);
  }

  private async find(
    workspaceId: string,
    projectId: string,
    workItemId: string,
  ): Promise<ProjectWorkItem | null> {
    /*
     * Both tables are asked, because a work-item id does not say which one it
     * came from. That is the cost of not merging them, and it is one indexed
     * primary-key lookup — cheaper than the migration that would avoid it.
     */
    const [task, ticket] = await Promise.all([
      this.prisma.task.findFirst({
        where: { id: workItemId, workspaceId, projectId },
        include: workItemTaskInclude,
      }),
      this.prisma.ticket.findFirst({
        where: { id: workItemId, workspaceId, projectId },
        include: workItemTicketInclude,
      }),
    ]);

    if (task) return taskToWorkItem(task);
    if (ticket) return ticketToWorkItem(ticket);
    return null;
  }

  /**
   * Checks the section belongs to this project before anything is written.
   *
   * A section id from another project would otherwise file the item somewhere
   * its own project cannot see — visible to whoever owns that section, which is
   * a cross-project leak dressed up as a typo.
   */
  private async resolveSection(
    projectId: string,
    sectionId: string | null | undefined,
    required = false,
  ): Promise<string | null> {
    if (sectionId === null) return null;

    if (sectionId === undefined) {
      if (required) return null;

      // Nothing named: the first section, so an item created from a toolbar
      // lands somewhere visible rather than in a limbo the views do not draw.
      const first = await this.prisma.section.findFirst({
        where: { projectId },
        orderBy: { position: 'asc' },
        select: { id: true },
      });

      return first?.id ?? null;
    }

    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, projectId },
      select: { id: true },
    });

    if (!section) {
      throw AppException.badRequest('BAD_REQUEST', 'That section is not in this project.');
    }

    return section.id;
  }

  /** Every item already in the section, both kinds, for placement. */
  private async siblingPositions(
    workspaceId: string,
    projectId: string,
    sectionId: string | null,
  ): Promise<{ id: string; position: number }[]> {
    const where = { workspaceId, projectId, sectionId, archivedAt: null };

    const [tasks, tickets] = await Promise.all([
      this.prisma.task.findMany({
        where: { ...where, parentTaskId: null },
        select: { id: true, position: true },
      }),
      this.prisma.ticket.findMany({ where, select: { id: true, position: true } }),
    ]);

    return [...tasks, ...tickets].sort((a, b) => a.position - b.position);
  }

  private async nextPosition(
    workspaceId: string,
    projectId: string,
    sectionId: string | null,
    afterId: string | null | undefined,
  ): Promise<number> {
    const siblings = await this.siblingPositions(workspaceId, projectId, sectionId);

    return planPlacement(siblings, afterId).position;
  }

  /**
   * `beforeId` expressed as the `afterId` the placement helper understands.
   *
   * The move contract accepts either anchor because a drag knows what it landed
   * next to, not which side the helper prefers. Translating once here means the
   * two spellings cannot diverge.
   */
  private resolveAnchor(
    siblings: { id: string; position: number }[],
    payload: MoveWorkItemPayload,
  ): string | null | undefined {
    if (payload.beforeId === undefined || payload.beforeId === null) {
      return payload.afterId;
    }

    const index = siblings.findIndex((item) => item.id === payload.beforeId);
    if (index <= 0) return null;

    return siblings[index - 1]?.id ?? null;
  }

  private changedFields(before: ProjectWorkItem, after: ProjectWorkItem): string[] {
    const fields: string[] = [];

    if (before.title !== after.title) fields.push('title');
    if (before.description !== after.description) fields.push('description');
    if (before.status?.id !== after.status?.id) fields.push('status');
    if (before.priority?.id !== after.priority?.id) fields.push('priority');
    // A changed time counts as a changed date: "due date changed" is what a
    // rule watching the deadline means, whether the day or the hour moved.
    if (before.dueDate !== after.dueDate || before.dueAt !== after.dueAt) fields.push('dueDate');
    if (before.startDate !== after.startDate || before.startAt !== after.startAt) {
      fields.push('startDate');
    }
    if (estimateOf(before) !== estimateOf(after)) fields.push('estimatedMinutes');

    const assignees = (item: ProjectWorkItem) =>
      item.assignees
        .map((user) => user.id)
        .sort()
        .join(',');
    if (assignees(before) !== assignees(after)) fields.push('assignees');

    return fields;
  }

  private triggersFor(
    before: ProjectWorkItem,
    after: ProjectWorkItem,
    changedFields: string[],
  ): AutomationTrigger[] {
    const triggers: AutomationTrigger[] =
      after.type === WorkItemType.TICKET ? [] : [AutomationTrigger.TASK_UPDATED];

    // Only the specific ones that actually happened. Publishing every trigger
    // on every update would fire rules whose condition never changed.
    if (changedFields.includes('status')) {
      triggers.push(
        after.type === WorkItemType.TICKET
          ? AutomationTrigger.TICKET_STATUS_CHANGED
          : AutomationTrigger.TASK_STATUS_CHANGED,
      );
    }
    if (changedFields.includes('priority')) {
      triggers.push(AutomationTrigger.TASK_PRIORITY_CHANGED);
    }
    if (changedFields.includes('assignees') && after.assignees.length > 0) {
      triggers.push(AutomationTrigger.TASK_ASSIGNED);
    }
    if (before.completedAt === null && after.completedAt !== null) {
      triggers.push(AutomationTrigger.TASK_COMPLETED);
    }
    // The fields a rule can watch on their own. Tickets raise none of these:
    // a rule's actions operate on tasks, and the ticket triggers stay greyed.
    if (after.type !== WorkItemType.TICKET) {
      triggers.push(...fieldChangeTriggers(changedFields));
    }

    return [...new Set(triggers)];
  }

  /** The follower link for whichever table backs this item. */
  private linkOf(item: ProjectWorkItem) {
    return item.type === WorkItemType.TICKET ? ticketLink(item.id) : taskLink(item.id);
  }

  /** The item as a notification names it. */
  private refOf(item: ProjectWorkItem): ItemRef {
    return item.details.kind === 'TICKET'
      ? ticketRef(item.workspaceId, { id: item.id, key: item.details.key })
      : taskRef(item.workspaceId, item);
  }

  /** Who a description names, and where its notification should lead. */
  private mentionTarget(item: ProjectWorkItem, actorId: string) {
    const shared = { workspaceId: item.workspaceId, actorId, entityId: item.id };

    if (item.details.kind === 'TICKET') {
      return {
        ...shared,
        entity: 'TICKET' as const,
        label: item.details.key,
        actionUrl: `/tickets?ticket=${item.details.key}`,
      };
    }

    return {
      ...shared,
      entity: 'TASK' as const,
      label: `“${item.title}”`,
      actionUrl: `/my-tasks?task=${item.id}`,
    };
  }

  private describe(item: ProjectWorkItem, verb: string): string {
    const name =
      item.details.kind === 'TICKET' ? `${item.details.key} "${item.title}"` : `"${item.title}"`;

    return `${verb} ${item.type.toLowerCase()} ${name}`;
  }

  /**
   * One event shape for every change, sent to the project room.
   *
   * The room rather than the whole workspace: everybody watching this project
   * needs it and nobody else does, and a workspace-wide broadcast makes every
   * open tab decide whether a change concerns it.
   */
  private emit(
    event: string,
    item: ProjectWorkItem,
    actorId: string | null,
    extra: Partial<WorkItemEventPayload<ProjectWorkItem>> = {},
  ): void {
    const payload: WorkItemEventPayload<ProjectWorkItem> = {
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      workItemId: item.id,
      workItemType: item.type,
      workItem: item,
      actorId,
      occurredAt: new Date().toISOString(),
      ...extra,
    };

    this.realtime.emitToProject(item.projectId, event, payload);
  }
}

/** Kept next to the service so a repository and its caller agree on the shape. */
export type WorkItemPrismaClient = Prisma.TransactionClient;

/** A task's estimate, off its details; a ticket carries none. */
function estimateOf(item: ProjectWorkItem): number | null {
  return item.details.kind === 'TASK' ? item.details.estimatedMinutes : null;
}
