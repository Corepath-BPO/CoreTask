import {
  AutomationTrigger,
  MAX_TASK_EXTRA_PROJECTS,
  ServerEvent,
  WorkItemType,
  WorkspaceRole,
  type WorkItemEventPayload,
} from '@coretask/contracts';
import type { AddTaskToProjectPayload, ProjectWorkItem, TaskDetail } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { ActivityAction, ActivityEntity } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { AutomationEventPublisher } from '../automations/automation-event.publisher';
import { ProjectAccessService } from '../project-access/project-access.service';
import { inProject, taskToWorkItem, workItemTaskInclude } from '../work-items/lib/work-item.mapper';

import { endOfSection, leaveHome } from './task-projects';
import { TasksService } from './tasks.service';

/**
 * Multi-homing from the task's side — Asana's "Projects" block in the pane:
 * add a task to another project, pick its section there, take it out again.
 *
 * Changing a task's projects needs edit rights on the task (from any of its
 * projects) and on the project being joined or left. Joining fires that
 * project's "task is added" rules; every board involved hears of it.
 */
@Injectable()
export class TaskProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly access: ProjectAccessService,
    private readonly activity: ActivityLogsService,
    private readonly automation: AutomationEventPublisher,
    private readonly realtime: RealtimeGateway,
  ) {}

  async add(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    payload: AddTaskToProjectPayload,
  ): Promise<TaskDetail> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    if (task.parentTaskId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'A subtask lives with its parent. Add the parent task to the project instead.',
      );
    }
    if (task.projectId === payload.projectId) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'The task is already in that project.');
    }

    const access = await this.access.requireAccess(
      workspaceId,
      payload.projectId,
      actor,
      WorkspaceRole.MEMBER,
    );
    if (access.project.archivedAt) {
      throw AppException.badRequest('BAD_REQUEST', 'That project is archived.');
    }

    const existing = await this.prisma.taskProject.findUnique({
      where: { taskId_projectId: { taskId, projectId: payload.projectId } },
    });
    if (existing) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'The task is already in that project.');
    }
    if ((await this.prisma.taskProject.count({ where: { taskId } })) >= MAX_TASK_EXTRA_PROJECTS) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A task can be in up to ${MAX_TASK_EXTRA_PROJECTS + 1} projects.`,
      );
    }

    const sectionId = await this.resolveSection(payload.projectId, payload.sectionId);
    const position = await endOfSection(this.prisma, workspaceId, payload.projectId, sectionId);

    if (task.projectId === null) {
      // A task with no project gets this one as its home, not as an extra.
      await this.prisma.task.update({
        where: { id: taskId },
        data: { projectId: payload.projectId, sectionId, position },
      });
    } else {
      await this.prisma.taskProject.create({
        data: {
          taskId,
          projectId: payload.projectId,
          sectionId,
          position,
          addedById: actor.userId,
        },
      });
    }

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.TASK,
      entityId: taskId,
      projectId: payload.projectId,
      summary: `Added this task to ${access.project.name}`,
      metadata: { addedToProjectId: payload.projectId, sectionId },
    });

    // "Task is added to this project" — the joined project's rules hear it.
    await this.automation.publish({
      workspaceId,
      projectId: payload.projectId,
      trigger: AutomationTrigger.TASK_CREATED,
      entityType: 'TASK',
      entityId: taskId,
      actorId: actor.userId,
      after: { title: task.title, sectionId },
    });

    await this.emit(ServerEvent.WORK_ITEM_CREATED, taskId, [payload.projectId], actor.userId);

    return this.tasks.getDetail(workspaceId, taskId, actor);
  }

  /** The task's section in one of its projects; its home's goes through the usual move. */
  async setSection(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    projectId: string,
    sectionId: string | null,
  ): Promise<TaskDetail> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);

    if (task.projectId === projectId) {
      await this.tasks.move(workspaceId, actor, taskId, { sectionId, afterTaskId: null });
      return this.tasks.getDetail(workspaceId, taskId, actor);
    }

    const link = await this.prisma.taskProject.findUnique({
      where: { taskId_projectId: { taskId, projectId } },
    });
    if (!link)
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'The task is not in that project.');
    await this.access.requireAccess(workspaceId, projectId, actor, WorkspaceRole.MEMBER);

    const target = await this.resolveSection(projectId, sectionId);
    if (target !== link.sectionId) {
      const position = await endOfSection(this.prisma, workspaceId, projectId, target);
      await this.prisma.taskProject.update({
        where: { taskId_projectId: { taskId, projectId } },
        data: { sectionId: target, position },
      });

      await this.automation.publish({
        workspaceId,
        projectId,
        trigger: AutomationTrigger.TASK_MOVED_TO_SECTION,
        entityType: 'TASK',
        entityId: taskId,
        actorId: actor.userId,
        before: { sectionId: link.sectionId },
        after: { sectionId: target },
      });
      await this.emit(ServerEvent.WORK_ITEM_MOVED, taskId, [projectId], actor.userId);
    }

    return this.tasks.getDetail(workspaceId, taskId, actor);
  }

  /**
   * Takes the task out of one project. Leaving its home, the project it joined
   * first becomes its home; leaving its only project leaves it in none.
   * Returns the task as the caller can now see it, or null if they cannot.
   */
  async remove(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    projectId: string,
  ): Promise<TaskDetail | null> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    const access = await this.access.requireAccess(
      workspaceId,
      projectId,
      actor,
      WorkspaceRole.MEMBER,
    );

    let newHome: string | null = null;
    if (task.projectId === projectId) {
      newHome = (await leaveHome(this.prisma, taskId))?.projectId ?? null;
    } else {
      const removed = await this.prisma.taskProject.deleteMany({ where: { taskId, projectId } });
      if (removed.count === 0) {
        throw AppException.notFound('RESOURCE_NOT_FOUND', 'The task is not in that project.');
      }
    }

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.TASK,
      entityId: taskId,
      projectId,
      summary: `Removed this task from ${access.project.name}`,
      metadata: { removedFromProjectId: projectId, newHomeProjectId: newHome },
    });

    this.emitDeleted(workspaceId, taskId, projectId, actor.userId);
    if (newHome) await this.emit(ServerEvent.WORK_ITEM_UPDATED, taskId, [newHome], actor.userId);

    try {
      return await this.tasks.getDetail(workspaceId, taskId, actor);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------

  /** A section of `projectId`, its first when none is named, or null for none. */
  private async resolveSection(
    projectId: string,
    sectionId: string | null | undefined,
  ): Promise<string | null> {
    if (sectionId === null) return null;
    const section = await this.prisma.section.findFirst({
      where: sectionId === undefined ? { projectId } : { id: sectionId, projectId },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    if (sectionId !== undefined && !section) {
      throw AppException.badRequest('BAD_REQUEST', 'That section is not in that project.');
    }
    return section?.id ?? null;
  }

  /** The task as each named project's board shows it, sent to that board. */
  private async emit(event: string, taskId: string, projectIds: string[], actorId: string) {
    const row = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: workItemTaskInclude,
    });
    if (!row) return;
    const item = taskToWorkItem(row);
    for (const projectId of projectIds) {
      const shaped: ProjectWorkItem = inProject(item, projectId);
      const payload: WorkItemEventPayload<ProjectWorkItem> = {
        workspaceId: item.workspaceId,
        projectId,
        workItemId: taskId,
        workItemType: WorkItemType.TASK,
        workItem: shaped,
        actorId,
        occurredAt: new Date().toISOString(),
      };
      this.realtime.emitToProject(projectId, event, payload);
    }
  }

  private emitDeleted(workspaceId: string, taskId: string, projectId: string, actorId: string) {
    const payload: WorkItemEventPayload = {
      workspaceId,
      projectId,
      workItemId: taskId,
      workItemType: WorkItemType.TASK,
      actorId,
      occurredAt: new Date().toISOString(),
    };
    this.realtime.emitToProject(projectId, ServerEvent.WORK_ITEM_DELETED, payload);
  }
}
