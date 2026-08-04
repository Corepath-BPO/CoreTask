import {
  DEFAULT_PRIORITY_DEFINITIONS,
  DEFAULT_STATUS_DEFINITIONS,
  StatusCategory,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, PriorityDefinition, StatusDefinition } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ProjectsService } from '../projects/projects.service';

import type {
  CreatePriorityDto,
  CreateStatusDto,
  ReorderDto,
  UpdatePriorityDto,
  UpdateStatusDto,
} from './dto/definition.dto';

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'status';

@Injectable()
export class DefinitionsService {
  private readonly logger = new Logger(DefinitionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
  ) {}

  // -------------------------------------------------------------------------
  // Statuses
  // -------------------------------------------------------------------------

  /**
   * The statuses a project uses.
   *
   * A project's own set when it has defined one, otherwise the workspace's.
   * Merging the two would give a project every workspace status *plus* its own,
   * which is not what "override" means — a project that defines statuses is
   * saying these are the statuses, not these as well.
   */
  async listStatuses(workspaceId: string, projectId: string): Promise<StatusDefinition[]> {
    await this.projects.requireProject(workspaceId, projectId);
    await this.ensureWorkspaceDefaults(workspaceId);

    const own = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, projectId, isArchived: false },
      orderBy: { position: 'asc' },
    });

    if (own.length > 0) return own;

    return this.prisma.statusDefinition.findMany({
      where: { workspaceId, projectId: null, isArchived: false },
      orderBy: { position: 'asc' },
    });
  }

  async createStatus(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    dto: CreateStatusDto,
  ): Promise<StatusDefinition> {
    await this.projects.requireProject(workspaceId, projectId);
    this.assertMayManage(role);

    const last = await this.prisma.statusDefinition.findFirst({
      where: { workspaceId, projectId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    /*
     * The first project status copies the workspace set forward.
     *
     * Otherwise defining one status would silently replace all eight, and every
     * task in the project would point at a status the project no longer offers.
     */
    if (!last) {
      await this.forkWorkspaceStatuses(workspaceId, projectId);
    }

    const position = last ? last.position + 1 : DEFAULT_STATUS_DEFINITIONS.length;

    return this.prisma.statusDefinition
      .create({
        data: {
          workspaceId,
          projectId,
          name: dto.name,
          slug: slugify(dto.name),
          category: dto.category as StatusCategory,
          colorToken: dto.colorToken ?? 'gray',
          position,
        },
      })
      .catch(rethrowDuplicate('status'));
  }

  async updateStatus(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    statusId: string,
    dto: UpdateStatusDto,
  ): Promise<StatusDefinition> {
    const status = await this.requireStatus(workspaceId, projectId, statusId);
    this.assertMayManage(role);

    const data: Prisma.StatusDefinitionUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      // The slug follows the name because the backfill maps by slug, and a
      // stale slug would silently break a future re-run.
      data.slug = slugify(dto.name);
    }
    if (dto.category !== undefined) data.category = dto.category as StatusCategory;
    if (dto.colorToken !== undefined) data.colorToken = dto.colorToken;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.isArchived !== undefined) data.isArchived = dto.isArchived;

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    // Archiving a status that tasks still hold would leave those tasks pointing
    // at something no picker offers, with no way to change it back.
    if (dto.isArchived === true) {
      const inUse = await this.prisma.task.count({ where: { statusDefinitionId: statusId } });

      if (inUse > 0) {
        throw AppException.badRequest(
          'BAD_REQUEST',
          `${inUse} task(s) still use "${status.name}". Move them first.`,
        );
      }
    }

    return this.prisma.statusDefinition
      .update({ where: { id: statusId }, data })
      .catch(rethrowDuplicate('status'));
  }

  async removeStatus(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    statusId: string,
  ): Promise<{ deleted: true }> {
    const status = await this.requireStatus(workspaceId, projectId, statusId);
    this.assertMayManage(role);

    const inUse = await this.prisma.task.count({ where: { statusDefinitionId: statusId } });

    if (inUse > 0) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `${inUse} task(s) still use "${status.name}". Move them first.`,
      );
    }

    if (status.isDefault) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Make another status the default before deleting this one.',
      );
    }

    await this.prisma.statusDefinition.delete({ where: { id: statusId } });
    return { deleted: true };
  }

  async reorderStatuses(
    workspaceId: string,
    projectId: string,
    role: WorkspaceRole,
    dto: ReorderDto,
  ): Promise<StatusDefinition[]> {
    await this.projects.requireProject(workspaceId, projectId);
    this.assertMayManage(role);

    const owned = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, id: { in: dto.ids } },
      select: { id: true },
    });

    // Every id must belong to this workspace, or a reorder becomes a way to
    // discover which ids exist elsewhere.
    if (owned.length !== dto.ids.length) {
      throw AppException.badRequest('BAD_REQUEST', 'That list contains an unknown status.');
    }

    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.statusDefinition.update({ where: { id }, data: { position: index } }),
      ),
    );

    return this.listStatuses(workspaceId, projectId);
  }

  // -------------------------------------------------------------------------
  // Priorities
  // -------------------------------------------------------------------------

  async listPriorities(workspaceId: string): Promise<PriorityDefinition[]> {
    await this.ensureWorkspaceDefaults(workspaceId);

    return this.prisma.priorityDefinition.findMany({
      where: { workspaceId, isArchived: false },
      orderBy: { position: 'asc' },
    });
  }

  async createPriority(
    workspaceId: string,
    role: WorkspaceRole,
    dto: CreatePriorityDto,
  ): Promise<PriorityDefinition> {
    this.assertMayManage(role);

    const last = await this.prisma.priorityDefinition.findFirst({
      where: { workspaceId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    return this.prisma.priorityDefinition
      .create({
        data: {
          workspaceId,
          name: dto.name,
          slug: slugify(dto.name),
          level: dto.level,
          colorToken: dto.colorToken ?? 'gray',
          position: (last?.position ?? 0) + 1,
        },
      })
      .catch(rethrowDuplicate('priority'));
  }

  async updatePriority(
    workspaceId: string,
    role: WorkspaceRole,
    priorityId: string,
    dto: UpdatePriorityDto,
  ): Promise<PriorityDefinition> {
    await this.requirePriority(workspaceId, priorityId);
    this.assertMayManage(role);

    const data: Prisma.PriorityDefinitionUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = dto.name;
      data.slug = slugify(dto.name);
    }
    if (dto.level !== undefined) data.level = dto.level;
    if (dto.colorToken !== undefined) data.colorToken = dto.colorToken;
    if (dto.isArchived !== undefined) data.isArchived = dto.isArchived;

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    return this.prisma.priorityDefinition
      .update({ where: { id: priorityId }, data })
      .catch(rethrowDuplicate('priority'));
  }

  async removePriority(
    workspaceId: string,
    role: WorkspaceRole,
    priorityId: string,
  ): Promise<{ deleted: true }> {
    const priority = await this.requirePriority(workspaceId, priorityId);
    this.assertMayManage(role);

    const inUse = await this.prisma.task.count({ where: { priorityDefinitionId: priorityId } });

    if (inUse > 0) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `${inUse} task(s) still use "${priority.name}". Move them first.`,
      );
    }

    await this.prisma.priorityDefinition.delete({ where: { id: priorityId } });
    return { deleted: true };
  }

  async reorderPriorities(
    workspaceId: string,
    role: WorkspaceRole,
    dto: ReorderDto,
  ): Promise<PriorityDefinition[]> {
    this.assertMayManage(role);

    const owned = await this.prisma.priorityDefinition.findMany({
      where: { workspaceId, id: { in: dto.ids } },
      select: { id: true },
    });

    if (owned.length !== dto.ids.length) {
      throw AppException.badRequest('BAD_REQUEST', 'That list contains an unknown priority.');
    }

    await this.prisma.$transaction(
      dto.ids.map((id, index) =>
        this.prisma.priorityDefinition.update({ where: { id }, data: { position: index } }),
      ),
    );

    return this.listPriorities(workspaceId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Seeds a workspace's default sets if it has none.
   *
   * The backfill covers workspaces that existed when it ran; this covers every
   * one created since, so both paths converge on the same eight statuses and
   * five priorities without a second migration.
   */
  async ensureWorkspaceDefaults(workspaceId: string): Promise<void> {
    const [statuses, priorities] = await Promise.all([
      this.prisma.statusDefinition.count({ where: { workspaceId, projectId: null } }),
      this.prisma.priorityDefinition.count({ where: { workspaceId } }),
    ]);

    if (statuses === 0) {
      await this.prisma.statusDefinition.createMany({
        data: DEFAULT_STATUS_DEFINITIONS.map((definition, index) => ({
          workspaceId,
          name: definition.name,
          slug: definition.slug,
          category: definition.category as StatusCategory,
          colorToken: definition.colorToken,
          position: index,
          isDefault: definition.isDefault,
        })),
        skipDuplicates: true,
      });
    }

    if (priorities === 0) {
      await this.prisma.priorityDefinition.createMany({
        data: DEFAULT_PRIORITY_DEFINITIONS.map((definition, index) => ({
          workspaceId,
          name: definition.name,
          slug: slugify(definition.name),
          level: definition.level,
          colorToken: definition.colorToken,
          position: index,
          isDefault: definition.isDefault,
        })),
        skipDuplicates: true,
      });
    }
  }

  /** Copies the workspace set into a project, so an override starts complete. */
  private async forkWorkspaceStatuses(workspaceId: string, projectId: string): Promise<void> {
    const workspaceStatuses = await this.prisma.statusDefinition.findMany({
      where: { workspaceId, projectId: null },
      orderBy: { position: 'asc' },
    });

    await this.prisma.statusDefinition.createMany({
      data: workspaceStatuses.map((status) => ({
        workspaceId,
        projectId,
        name: status.name,
        slug: status.slug,
        category: status.category,
        colorToken: status.colorToken,
        customColor: status.customColor,
        icon: status.icon,
        position: status.position,
        isDefault: status.isDefault,
      })),
      skipDuplicates: true,
    });
  }

  private assertMayManage(role: WorkspaceRole): void {
    if (!hasAtLeastRole(role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only a workspace manager can change statuses and priorities.',
      );
    }
  }

  private async requireStatus(
    workspaceId: string,
    projectId: string,
    statusId: string,
  ): Promise<StatusDefinition> {
    const status = await this.prisma.statusDefinition.findFirst({
      // Either the project's own or the workspace set it inherits — both are
      // statuses this project legitimately addresses.
      where: { id: statusId, workspaceId, OR: [{ projectId }, { projectId: null }] },
    });

    if (!status) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Status not found.');
    }

    return status;
  }

  private async requirePriority(
    workspaceId: string,
    priorityId: string,
  ): Promise<PriorityDefinition> {
    const priority = await this.prisma.priorityDefinition.findFirst({
      where: { id: priorityId, workspaceId },
    });

    if (!priority) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Priority not found.');
    }

    return priority;
  }
}

function rethrowDuplicate(kind: string) {
  return (error: unknown): never => {
    if ((error as { code?: string }).code === 'P2002') {
      throw AppException.conflict('RESOURCE_CONFLICT', `A ${kind} by that name already exists.`);
    }
    throw error;
  };
}
