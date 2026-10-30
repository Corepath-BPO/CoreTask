import {
  MAX_PORTFOLIO_PROJECTS,
  PortfolioWorkloadMeasure,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { Portfolio, PortfolioDraft } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

/** Gap between neighbours, so an added project lands at the end in one write. */
const STEP = 1024;

/**
 * Portfolios — a named set of projects watched together, Asana's way of
 * seeing several projects' status side by side.
 *
 * Workspace-wide: every member sees the workspace's portfolios. What each
 * person sees *inside* one is still filtered by project visibility, so a
 * private project in somebody else's portfolio stays invisible to whoever
 * cannot open it. Stars are per person.
 *
 * Creating one, and adding projects to it, is for members; renaming or
 * deleting it is its owner's, or a manager's.
 */
@Injectable()
export class PortfoliosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(workspaceId: string, actor: ActorContext): Promise<Portfolio[]> {
    const rows = await this.prisma.portfolio.findMany({
      where: { workspaceId },
      include: this.include(actor),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toDto(row));
  }

  async create(
    workspaceId: string,
    actor: ActorContext,
    draft: PortfolioDraft,
  ): Promise<Portfolio> {
    this.assertMember(actor);

    const row = await this.prisma.portfolio.create({
      data: {
        workspaceId,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
        color: draft.color,
        ownerId: actor.userId,
      },
      include: this.include(actor),
    });
    return this.toDto(row);
  }

  async update(
    workspaceId: string,
    portfolioId: string,
    actor: ActorContext,
    draft: Partial<PortfolioDraft>,
  ): Promise<Portfolio> {
    const portfolio = await this.require(workspaceId, portfolioId);
    this.assertOwnerOrManager(portfolio.ownerId, actor);

    const row = await this.prisma.portfolio.update({
      where: { id: portfolioId },
      data: {
        ...(draft.name !== undefined ? { name: draft.name.trim() } : {}),
        ...(draft.description !== undefined
          ? { description: draft.description?.trim() || null }
          : {}),
        ...(draft.color !== undefined ? { color: draft.color } : {}),
        ...(draft.workloadMeasure !== undefined ? { workloadMeasure: draft.workloadMeasure } : {}),
        ...(draft.defaultCapacity !== undefined ? { defaultCapacity: draft.defaultCapacity } : {}),
      },
      include: this.include(actor),
    });
    return this.toDto(row);
  }

  async remove(workspaceId: string, portfolioId: string, actor: ActorContext): Promise<void> {
    const portfolio = await this.require(workspaceId, portfolioId);
    this.assertOwnerOrManager(portfolio.ownerId, actor);
    await this.prisma.portfolio.delete({ where: { id: portfolioId } });
  }

  async addProjects(
    workspaceId: string,
    portfolioId: string,
    actor: ActorContext,
    projectIds: string[],
  ): Promise<Portfolio> {
    this.assertMember(actor);
    await this.require(workspaceId, portfolioId);

    const wanted = [...new Set(projectIds)];
    // Only projects the caller can open: adding one is not a way to learn it exists.
    const visible = await this.prisma.project.findMany({
      where: { id: { in: wanted }, workspaceId, AND: [this.access.projectWhere(actor)] },
      select: { id: true },
    });
    if (visible.length !== wanted.length) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'A project to add was not found.');
    }

    const existing = await this.prisma.portfolioProject.findMany({
      where: { portfolioId },
      select: { projectId: true, position: true },
      orderBy: { position: 'desc' },
    });
    const fresh = wanted.filter((id) => !existing.some((row) => row.projectId === id));
    if (existing.length + fresh.length > MAX_PORTFOLIO_PROJECTS) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A portfolio holds up to ${MAX_PORTFOLIO_PROJECTS} projects.`,
      );
    }

    const last = existing[0]?.position ?? 0;
    if (fresh.length > 0) {
      await this.prisma.portfolioProject.createMany({
        data: fresh.map((projectId, index) => ({
          portfolioId,
          projectId,
          position: last + STEP * (index + 1),
        })),
        skipDuplicates: true,
      });
    }

    return this.read(portfolioId, actor);
  }

  async removeProject(
    workspaceId: string,
    portfolioId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<Portfolio> {
    this.assertMember(actor);
    await this.require(workspaceId, portfolioId);
    await this.prisma.portfolioProject.deleteMany({ where: { portfolioId, projectId } });
    return this.read(portfolioId, actor);
  }

  async setStar(
    workspaceId: string,
    portfolioId: string,
    actor: ActorContext,
    starred: boolean,
  ): Promise<Portfolio> {
    await this.require(workspaceId, portfolioId);

    if (starred) {
      await this.prisma.portfolioStar.createMany({
        data: [{ portfolioId, userId: actor.userId }],
        skipDuplicates: true,
      });
    } else {
      await this.prisma.portfolioStar.deleteMany({ where: { portfolioId, userId: actor.userId } });
    }

    return this.read(portfolioId, actor);
  }

  /**
   * One person's capacity on the Workload tab — or, with null, back to the
   * portfolio's default. Set by whoever may change the portfolio.
   */
  async setCapacity(
    workspaceId: string,
    portfolioId: string,
    userId: string,
    actor: ActorContext,
    capacity: number | null,
  ): Promise<Portfolio> {
    const portfolio = await this.require(workspaceId, portfolioId);
    this.assertOwnerOrManager(portfolio.ownerId, actor);

    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, userId, deactivatedAt: null },
      select: { userId: true },
    });
    if (!member)
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Not a member of this workspace.');

    if (capacity === null) {
      await this.prisma.portfolioCapacity.deleteMany({ where: { portfolioId, userId } });
    } else {
      await this.prisma.portfolioCapacity.upsert({
        where: { portfolioId_userId: { portfolioId, userId } },
        create: { portfolioId, userId, capacity },
        update: { capacity },
      });
    }

    return this.read(portfolioId, actor);
  }

  // -------------------------------------------------------------------------

  private include(actor: ActorContext) {
    return {
      projects: {
        where: { project: { archivedAt: null, AND: [this.access.projectWhere(actor)] } },
        orderBy: { position: 'asc' },
        select: { projectId: true },
      },
      stars: { where: { userId: actor.userId }, select: { userId: true } },
      owner: { select: { id: true, name: true, avatarUrl: true } },
      capacities: { select: { userId: true, capacity: true } },
      statusUpdates: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { status: true, createdAt: true },
      },
    } satisfies Prisma.PortfolioInclude;
  }

  private toDto(
    row: Prisma.PortfolioGetPayload<{ include: ReturnType<PortfoliosService['include']> }>,
  ): Portfolio {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      projectIds: row.projects.map((entry) => entry.projectId),
      starred: row.stars.length > 0,
      owner: row.owner,
      workload: {
        measure:
          row.workloadMeasure === PortfolioWorkloadMeasure.HOURS
            ? PortfolioWorkloadMeasure.HOURS
            : PortfolioWorkloadMeasure.TASKS,
        defaultCapacity: row.defaultCapacity,
        capacities: row.capacities,
      },
      status: row.statusUpdates[0]
        ? {
            value: row.statusUpdates[0].status,
            createdAt: row.statusUpdates[0].createdAt.toISOString(),
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async read(portfolioId: string, actor: ActorContext): Promise<Portfolio> {
    const row = await this.prisma.portfolio.findUniqueOrThrow({
      where: { id: portfolioId },
      include: this.include(actor),
    });
    return this.toDto(row);
  }

  private async require(workspaceId: string, portfolioId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: portfolioId, workspaceId },
      select: { id: true, ownerId: true },
    });
    if (!portfolio) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Portfolio not found.');
    return portfolio;
  }

  private assertMember(actor: ActorContext): void {
    if (!hasAtLeastRole(actor.role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'Guests cannot change portfolios.');
    }
  }

  private assertOwnerOrManager(ownerId: string | null, actor: ActorContext): void {
    if (ownerId === actor.userId) return;
    if (!hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only the portfolio’s owner or a manager can change it.',
      );
    }
  }
}
