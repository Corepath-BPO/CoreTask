import {
  ActivityAction,
  ActivityEntity,
  NotificationType,
  WorkspaceRole,
} from '@coretask/contracts';
import type { Workspace as WorkspaceDto, WorkspaceSummary } from '@coretask/types';
import { slugify } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Workspace } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { WorkspaceMembersService } from '../workspace-members/workspace-members.service';

import type { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/workspace.dto';

@Injectable()
export class WorkspacesService {
  private readonly logger = new Logger(WorkspacesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: WorkspaceMembersService,
    private readonly activity: ActivityLogsService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  /**
   * Workspaces the user belongs to.
   *
   * Scoped by membership rather than by any client-supplied filter — this is the
   * only list endpoint, so there is no "all workspaces" query to get wrong.
   */
  async listForUser(userId: string): Promise<WorkspaceSummary[]> {
    const memberships = await this.prisma.workspaceMember.findMany({
      where: { userId, workspace: { archivedAt: null } },
      orderBy: { joinedAt: 'asc' },
      include: {
        workspace: {
          include: {
            _count: { select: { members: true, projects: true } },
          },
        },
      },
    });

    return memberships.map((membership) =>
      toWorkspaceSummary(
        membership.workspace,
        membership.role,
        membership.workspace._count.members,
        membership.workspace._count.projects,
      ),
    );
  }

  /** Membership is verified by `WorkspaceMemberGuard` before this runs. */
  async getForUser(workspaceId: string, userId: string): Promise<WorkspaceSummary> {
    const membership = await this.members.requireMembership(workspaceId, userId);

    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      include: { _count: { select: { members: true, projects: true } } },
    });

    if (!workspace) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Workspace not found.');
    }

    return toWorkspaceSummary(
      workspace,
      membership.role,
      workspace._count.members,
      workspace._count.projects,
    );
  }

  async create(userId: string, dto: CreateWorkspaceDto): Promise<WorkspaceSummary> {
    const slug = await this.resolveSlug(dto.slug ?? slugify(dto.name));

    const workspace = await this.prisma.$transaction(async (tx) => {
      const created = await tx.workspace.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description ?? null,
          ticketPrefix: deriveTicketPrefix(dto.name),
          createdById: userId,
        },
      });

      // The creator is the owner. Doing this in the same transaction means a
      // workspace can never exist without someone able to administer it.
      await this.members.addMember(
        { workspaceId: created.id, userId, role: WorkspaceRole.OWNER },
        tx,
      );

      return created;
    });

    await this.activity.record({
      workspaceId: workspace.id,
      actorId: userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspace.id,
      summary: `Created workspace "${workspace.name}"`,
      metadata: { slug: workspace.slug },
    });

    await this.notifications.dispatch({
      userId,
      workspaceId: workspace.id,
      type: NotificationType.WORKSPACE_INVITE,
      title: `${workspace.name} is ready`,
      body: 'You are the owner of this workspace. Invite your team to get started.',
      entity: ActivityEntity.WORKSPACE,
      entityId: workspace.id,
      actionUrl: `/w/${workspace.slug}`,
    });

    this.logger.log({ workspaceId: workspace.id, userId }, 'Workspace created');

    return toWorkspaceSummary(workspace, WorkspaceRole.OWNER, 1, 0);
  }

  async update(
    workspaceId: string,
    userId: string,
    dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceSummary> {
    await this.members.requireRole(workspaceId, userId, WorkspaceRole.ADMIN);

    const data: Prisma.WorkspaceUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data,
      include: { _count: { select: { members: true, projects: true } } },
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: `Updated workspace settings`,
      metadata: { fields: Object.keys(data) },
    });

    const membership = await this.members.requireMembership(workspaceId, userId);

    return toWorkspaceSummary(
      workspace,
      membership.role,
      workspace._count.members,
      workspace._count.projects,
    );
  }

  /** Appends `-2`, `-3`, … until the slug is free. */
  private async resolveSlug(base: string): Promise<string> {
    const normalized = base.length >= 2 ? base : `workspace-${base}`;

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const candidate = attempt === 0 ? normalized : `${normalized}-${attempt + 1}`;
      const existing = await this.prisma.workspace.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });

      if (!existing) return candidate;
    }

    throw AppException.conflict('WORKSPACE_SLUG_TAKEN');
  }
}

/** `Acme Product` -> `ACME`; falls back to `TASK` for names without letters. */
function deriveTicketPrefix(name: string): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const candidate = letters.slice(0, 4);

  return /^[A-Z][A-Z0-9]{1,7}$/.test(candidate) ? candidate : 'TASK';
}

function toWorkspaceSummary(
  workspace: Workspace,
  role: string,
  memberCount: number,
  projectCount: number,
): WorkspaceSummary {
  return {
    ...toWorkspace(workspace),
    role: role as WorkspaceSummary['role'],
    memberCount,
    projectCount,
  };
}

function toWorkspace(workspace: Workspace): WorkspaceDto {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    logoUrl: workspace.logoUrl,
    ticketPrefix: workspace.ticketPrefix,
    createdAt: workspace.createdAt.toISOString(),
    updatedAt: workspace.updatedAt.toISOString(),
  };
}
