import {
  MAX_TAGS_PER_TASK,
  MAX_TAGS_PER_WORKSPACE,
  TAG_COLOR_CYCLE,
  WorkspaceRole,
  hasAtLeastRole,
  tagNameKey,
  type ColorToken,
} from '@coretask/contracts';
import type { Tag, TagRef } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import { ActivityAction, ActivityEntity, Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { TasksService } from '../tasks/tasks.service';

import { taskTagsInclude, toTagRefs } from './tag.mapper';

const tagInclude = {
  createdBy: { select: { id: true, name: true } },
  _count: { select: { tasks: true } },
} satisfies Prisma.TagInclude;

type TagRow = Prisma.TagGetPayload<{ include: typeof tagInclude }>;

const toDto = (row: TagRow): Tag => ({
  id: row.id,
  name: row.name,
  color: row.color as ColorToken,
  taskCount: row._count.tasks,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

/** A clean display name: trimmed, single-spaced. */
const displayName = (name: string) => name.trim().replace(/\s+/g, ' ');

/**
 * Tags — Asana's workspace-wide labels.
 *
 * Anyone who can edit work makes and edits tags (guests only read them); a tag
 * is deleted by whoever made it or a manager. A task's tags change with the
 * right to edit that task. Names are unique per workspace whatever their case.
 */
@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly activity: ActivityLogsService,
  ) {}

  async list(workspaceId: string): Promise<Tag[]> {
    const rows = await this.prisma.tag.findMany({
      where: { workspaceId },
      include: tagInclude,
      orderBy: { nameKey: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    workspaceId: string,
    actor: ActorContext,
    payload: { name: string; color?: ColorToken },
  ): Promise<Tag> {
    this.requireEditor(actor);
    const row = await this.make(workspaceId, actor, payload.name, payload.color);
    return toDto(row);
  }

  async update(
    workspaceId: string,
    actor: ActorContext,
    tagId: string,
    payload: { name?: string; color?: ColorToken },
  ): Promise<Tag> {
    this.requireEditor(actor);
    await this.requireTag(workspaceId, tagId);
    try {
      const row = await this.prisma.tag.update({
        where: { id: tagId },
        data: {
          ...(payload.name !== undefined
            ? { name: displayName(payload.name), nameKey: tagNameKey(payload.name) }
            : {}),
          ...(payload.color !== undefined ? { color: payload.color } : {}),
        },
        include: tagInclude,
      });
      return toDto(row);
    } catch (error) {
      throw this.duplicate(error, payload.name ?? '');
    }
  }

  async remove(workspaceId: string, actor: ActorContext, tagId: string): Promise<void> {
    const tag = await this.requireTag(workspaceId, tagId);
    if (tag.createdById !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only whoever made a tag, or a manager, can delete it.',
      );
    }
    const tagged = await this.prisma.taskTag.findMany({
      where: { tagId },
      select: { taskId: true },
    });
    await this.prisma.tag.delete({ where: { id: tagId } });
    for (const { taskId } of tagged.slice(0, 200)) {
      void this.tasks.announceUpdated(workspaceId, taskId);
    }
  }

  /** Adds a tag by id, or by name — making it when no tag has that name yet. */
  async addToTask(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    payload: { tagId?: string; name?: string },
  ): Promise<TagRef[]> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    let tag: { id: string; name: string };
    if (payload.tagId) {
      tag = await this.requireTag(workspaceId, payload.tagId);
    } else if (payload.name?.trim()) {
      tag =
        (await this.prisma.tag.findUnique({
          where: { workspaceId_nameKey: { workspaceId, nameKey: tagNameKey(payload.name) } },
        })) ?? (await this.make(workspaceId, actor, payload.name));
    } else {
      throw AppException.badRequest('BAD_REQUEST', 'Name a tag, or pick one.');
    }

    const already = await this.prisma.taskTag.findUnique({
      where: { taskId_tagId: { taskId, tagId: tag.id } },
    });
    if (!already) {
      if ((await this.prisma.taskTag.count({ where: { taskId } })) >= MAX_TAGS_PER_TASK) {
        throw AppException.badRequest(
          'BAD_REQUEST',
          `A task carries up to ${MAX_TAGS_PER_TASK} tags.`,
        );
      }
      await this.prisma.taskTag.create({ data: { taskId, tagId: tag.id } }).catch(() => undefined);
      await this.activity.record({
        workspaceId,
        actorId: actor.userId,
        action: ActivityAction.UPDATED,
        entity: ActivityEntity.TASK,
        entityId: taskId,
        projectId: task.projectId,
        summary: `Added the tag “${tag.name}” to "${task.title}"`,
        metadata: { tagId: tag.id },
      });
      await this.tasks.announceUpdated(workspaceId, taskId);
    }
    return this.tagsOf(taskId);
  }

  async removeFromTask(
    workspaceId: string,
    actor: ActorContext,
    taskId: string,
    tagId: string,
  ): Promise<TagRef[]> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    const removed = await this.prisma.taskTag.deleteMany({ where: { taskId, tagId } });
    if (removed.count > 0) {
      const tag = await this.prisma.tag.findUnique({
        where: { id: tagId },
        select: { name: true },
      });
      await this.activity.record({
        workspaceId,
        actorId: actor.userId,
        action: ActivityAction.UPDATED,
        entity: ActivityEntity.TASK,
        entityId: taskId,
        projectId: task.projectId,
        summary: `Removed the tag “${tag?.name ?? 'a tag'}” from "${task.title}"`,
        metadata: { tagId },
      });
      await this.tasks.announceUpdated(workspaceId, taskId);
    }
    return this.tagsOf(taskId);
  }

  // -------------------------------------------------------------------------

  private async tagsOf(taskId: string): Promise<TagRef[]> {
    const rows = await this.prisma.taskTag.findMany({
      where: { taskId },
      include: taskTagsInclude.include,
      orderBy: taskTagsInclude.orderBy,
    });
    return toTagRefs(rows);
  }

  private async make(
    workspaceId: string,
    actor: ActorContext,
    name: string,
    color?: ColorToken,
  ): Promise<TagRow> {
    this.requireEditor(actor);
    const clean = displayName(name);
    if (!clean) throw AppException.badRequest('BAD_REQUEST', 'A tag needs a name.');
    const count = await this.prisma.tag.count({ where: { workspaceId } });
    if (count >= MAX_TAGS_PER_WORKSPACE) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A workspace holds up to ${MAX_TAGS_PER_WORKSPACE} tags.`,
      );
    }
    try {
      return await this.prisma.tag.create({
        data: {
          workspaceId,
          name: clean,
          nameKey: tagNameKey(clean),
          // Each new tag takes the next colour round, so neighbours differ.
          color: color ?? TAG_COLOR_CYCLE[count % TAG_COLOR_CYCLE.length] ?? 'gray',
          createdById: actor.userId,
        },
        include: tagInclude,
      });
    } catch (error) {
      throw this.duplicate(error, clean);
    }
  }

  private duplicate(error: unknown, name: string): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return AppException.conflict(
        'RESOURCE_CONFLICT',
        `There is already a tag called “${displayName(name)}”.`,
      );
    }
    return error;
  }

  private requireEditor(actor: ActorContext) {
    if (!hasAtLeastRole(actor.role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden(
        'INSUFFICIENT_WORKSPACE_ROLE',
        'Guests cannot make or change tags.',
      );
    }
  }

  private async requireTag(workspaceId: string, tagId: string) {
    const tag = await this.prisma.tag.findFirst({ where: { id: tagId, workspaceId } });
    if (!tag) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Tag not found.');
    return tag;
  }
}
