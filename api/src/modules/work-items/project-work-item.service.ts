import {
  AutomationTrigger,
  CREATABLE_WORK_ITEM_TYPES,
  ServerEvent,
  WorkItemType,
  type WorkItemEventPayload,
} from '@coretask/contracts';
import type {
  CreateWorkItemPayload,
  MoveWorkItemPayload,
  ProjectWorkItem,
  ProjectWorkItemPage,
  ProjectWorkItemQuery,
  UpdateWorkItemPayload,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { ActivityAction, ActivityEntity, Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { planPlacement } from '../../common/utils/position.util';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
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

    const [tasks, tickets] = await Promise.all([
      wantsTasks ? this.tasks.list(workspaceId, projectId, query) : Promise.resolve([]),
      wantsTickets ? this.tickets.list(workspaceId, projectId, query) : Promise.resolve([]),
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
    const page = items.slice(0, limit);

    return {
      items: page,
      nextCursor: items.length > limit ? (page[page.length - 1]?.id ?? null) : null,
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

    return item;
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
    if (changedFields.length === 0) return updated;

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: updated.type === WorkItemType.TICKET ? ActivityEntity.TICKET : ActivityEntity.TASK,
      entityId: updated.id,
      summary: this.describe(updated, 'Updated'),
      metadata: { projectId, workItemType: updated.type, changedFields, source: 'USER' },
    });

    for (const trigger of this.triggersFor(before, updated, changedFields)) {
      await this.automation.publish({
        workspaceId,
        projectId,
        trigger,
        entityType: updated.type === WorkItemType.TICKET ? 'TICKET' : 'TASK',
        entityId: updated.id,
        actorId: userId,
        before: { status: before.status?.id, priority: before.priority?.id },
        after: { status: updated.status?.id, priority: updated.priority?.id },
        ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
      });
    }

    this.emit(ServerEvent.WORK_ITEM_UPDATED, updated, userId, {
      changedFields,
      ...(payload.correlationId ? { correlationId: payload.correlationId } : {}),
    });

    this.realtime.emitToWorkspace(
      workspaceId,
      updated.type === WorkItemType.TICKET ? ServerEvent.TICKET_UPDATED : ServerEvent.TASK_UPDATED,
      updated,
    );

    return updated;
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

    await this.activity.record({
      workspaceId,
      actorId: userId,
      // No MOVED action exists in the enum, and inventing one would need a
      // migration every reader of the feed then has to handle. The metadata
      // below says which sections, which is the part anybody wants.
      action: ActivityAction.UPDATED,
      entity: moved.type === WorkItemType.TICKET ? ActivityEntity.TICKET : ActivityEntity.TASK,
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

    return moved;
  }

  // ---------------------------------------------------------------- internals

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
    if (before.dueDate !== after.dueDate) fields.push('dueDate');
    if (before.startDate !== after.startDate) fields.push('startDate');

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
    const triggers: AutomationTrigger[] = [
      after.type === WorkItemType.TICKET
        ? AutomationTrigger.TICKET_STATUS_CHANGED
        : AutomationTrigger.TASK_UPDATED,
    ];

    // Only the specific ones that actually happened. Publishing every trigger
    // on every update would fire rules whose condition never changed.
    if (changedFields.includes('status') && after.type !== WorkItemType.TICKET) {
      triggers.push(AutomationTrigger.TASK_STATUS_CHANGED);
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

    return [...new Set(triggers)];
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
