import {
  MAX_TASK_TEMPLATES_PER_PROJECT,
  MAX_TEMPLATE_SUBTASKS,
  WorkspaceRole,
  type TaskKind,
  type TaskPriority,
} from '@coretask/contracts';
import type { Task, TaskTemplate, TaskTemplateDraft, TaskTemplateSubtask } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma, TaskTemplate as TemplateRow } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { normalizeRichText } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';
import { TasksService } from '../tasks/tasks.service';

/** The subtasks a stored template holds, read leniently. */
function readSubtasks(value: Prisma.JsonValue): TaskTemplateSubtask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return [];
    const record = row as Record<string, unknown>;
    const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
    if (!title) return [];
    return [
      {
        title,
        assigneeId: typeof record['assigneeId'] === 'string' ? record['assigneeId'] : null,
      },
    ];
  });
}

function toDto(row: TemplateRow): TaskTemplate {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    title: row.title,
    description: row.description,
    kind: row.kind,
    priority: row.priority,
    assigneeId: row.assigneeId,
    dueInDays: row.dueInDays,
    subtasks: readSubtasks(row.subtasks),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** `YYYY-MM-DD`, N days from now, as the task API takes a due date. */
function dayFromNow(days: number): string {
  const date = new Date(Date.now() + days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

/**
 * Task templates — Asana's "Task types and templates".
 *
 * A template is a project's ready-made task: a title, notes, a kind, an owner,
 * a due date counted from the day it is used, and a checklist of subtasks.
 * Using one goes through the tasks service, so the task it makes is placed,
 * announced and recorded exactly as one made by hand.
 *
 * Reading follows the project's visibility; writing and using are for whoever
 * can edit its tasks.
 */
@Injectable()
export class TaskTemplatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly tasks: TasksService,
  ) {}

  async list(workspaceId: string, projectId: string, actor: ActorContext): Promise<TaskTemplate[]> {
    await this.requireVisible(workspaceId, projectId, actor);
    const rows = await this.prisma.taskTemplate.findMany({
      where: { projectId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDto);
  }

  async create(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    draft: TaskTemplateDraft,
  ): Promise<TaskTemplate> {
    await this.requireEditor(workspaceId, projectId, actor);

    const count = await this.prisma.taskTemplate.count({ where: { projectId } });
    if (count >= MAX_TASK_TEMPLATES_PER_PROJECT) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A project holds up to ${MAX_TASK_TEMPLATES_PER_PROJECT} task templates.`,
      );
    }

    const row = await this.prisma.taskTemplate.create({
      data: {
        workspaceId,
        projectId,
        createdById: actor.userId,
        ...this.fields(draft),
        name: draft.name.trim(),
        title: draft.title.trim(),
      },
    });
    return toDto(row);
  }

  async update(
    workspaceId: string,
    projectId: string,
    templateId: string,
    actor: ActorContext,
    draft: Partial<TaskTemplateDraft>,
  ): Promise<TaskTemplate> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.require(projectId, templateId);

    const row = await this.prisma.taskTemplate.update({
      where: { id: templateId },
      data: {
        ...this.fields(draft),
        ...(draft.name !== undefined ? { name: draft.name.trim() } : {}),
        ...(draft.title !== undefined ? { title: draft.title.trim() } : {}),
      },
    });
    return toDto(row);
  }

  async remove(
    workspaceId: string,
    projectId: string,
    templateId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requireEditor(workspaceId, projectId, actor);
    await this.require(projectId, templateId);
    await this.prisma.taskTemplate.delete({ where: { id: templateId } });
  }

  /**
   * A task from the template, with its subtasks, in the chosen section — or
   * the project's first. People named who have since left are dropped
   * rather than failing the whole task.
   */
  async use(
    workspaceId: string,
    projectId: string,
    templateId: string,
    actor: ActorContext,
    sectionId?: string | null,
  ): Promise<Task> {
    await this.requireEditor(workspaceId, projectId, actor);
    const template = toDto(await this.require(projectId, templateId));

    const named = [
      template.assigneeId,
      ...template.subtasks.map((subtask) => subtask.assigneeId ?? null),
    ].filter((id): id is string => Boolean(id));
    const members = new Set(
      (
        await this.prisma.workspaceMember.findMany({
          where: { workspaceId, userId: { in: named }, deactivatedAt: null },
          select: { userId: true },
        })
      ).map((row) => row.userId),
    );
    const person = (id: string | null | undefined) => (id && members.has(id) ? id : null);

    // The chosen section, or the project's first — where Add task lands.
    const section =
      sectionId ??
      (
        await this.prisma.section.findFirst({
          where: { projectId },
          orderBy: { position: 'asc' },
          select: { id: true },
        })
      )?.id ??
      null;

    const task = await this.tasks.create(workspaceId, actor, {
      title: template.title,
      ...(template.description ? { description: template.description } : {}),
      projectId,
      ...(section ? { sectionId: section } : {}),
      kind: template.kind,
      ...(template.priority ? { priority: template.priority } : {}),
      assigneeId: person(template.assigneeId),
      ...(template.dueInDays !== null ? { dueDate: dayFromNow(template.dueInDays) } : {}),
    });

    for (const subtask of template.subtasks) {
      await this.tasks.create(workspaceId, actor, {
        title: subtask.title,
        parentTaskId: task.id,
        assigneeId: person(subtask.assigneeId),
      });
    }

    return task;
  }

  // -------------------------------------------------------------------------

  private fields(draft: Partial<TaskTemplateDraft>) {
    return {
      ...(draft.description !== undefined
        ? { description: normalizeRichText(draft.description) ?? null }
        : {}),
      ...(draft.kind !== undefined ? { kind: draft.kind as TaskKind } : {}),
      ...(draft.priority !== undefined ? { priority: draft.priority as TaskPriority | null } : {}),
      ...(draft.assigneeId !== undefined ? { assigneeId: draft.assigneeId } : {}),
      ...(draft.dueInDays !== undefined ? { dueInDays: draft.dueInDays } : {}),
      ...(draft.subtasks !== undefined
        ? {
            subtasks: draft.subtasks
              .map((subtask) => ({
                title: subtask.title.trim(),
                ...(subtask.assigneeId ? { assigneeId: subtask.assigneeId } : {}),
              }))
              .filter((subtask) => subtask.title !== '')
              .slice(0, MAX_TEMPLATE_SUBTASKS) as Prisma.InputJsonValue,
          }
        : {}),
    };
  }

  private async require(projectId: string, templateId: string): Promise<TemplateRow> {
    const row = await this.prisma.taskTemplate.findFirst({ where: { id: templateId, projectId } });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Task template not found.');
    return row;
  }

  private async requireVisible(workspaceId: string, projectId: string, actor: ActorContext) {
    const access = await this.access.findAccess(workspaceId, projectId, actor);
    if (!access) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
  }

  private async requireEditor(workspaceId: string, projectId: string, actor: ActorContext) {
    await this.requireVisible(workspaceId, projectId, actor);
    await this.access.assertEffectiveRole(projectId, actor, WorkspaceRole.MEMBER);
  }
}
