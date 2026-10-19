import { MAX_STARRED_PROJECTS } from '@coretask/contracts';
import type { StarredProject } from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

/** Gap between neighbours, so a new star always lands at the end in one write. */
const STEP = 1024;

/**
 * Someone's starred projects — Asana's sidebar favourites.
 *
 * Starring is open to anyone who can see the project, viewers included: it is
 * a bookmark and changes nothing anyone else sees. The list is filtered by the
 * same visibility rule every project list uses, so a project that turned
 * private drops out of the sidebar for whoever cannot open it any more.
 */
@Injectable()
export class ProjectStarsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(workspaceId: string, actor: ActorContext): Promise<StarredProject[]> {
    const stars = await this.prisma.projectStar.findMany({
      where: {
        userId: actor.userId,
        project: { workspaceId, archivedAt: null, AND: [this.access.projectWhere(actor)] },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: {
        position: true,
        project: { select: { id: true, name: true, key: true, color: true, status: true } },
      },
    });

    return stars.map((star) => ({ ...star.project, position: star.position }));
  }

  async star(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<StarredProject[]> {
    await this.requireVisible(workspaceId, projectId, actor);

    const existing = await this.prisma.projectStar.findUnique({
      where: { projectId_userId: { projectId, userId: actor.userId } },
    });

    if (!existing) {
      const count = await this.prisma.projectStar.count({ where: { userId: actor.userId } });
      if (count >= MAX_STARRED_PROJECTS) {
        throw AppException.badRequest(
          'BAD_REQUEST',
          `You can star up to ${MAX_STARRED_PROJECTS} projects. Unstar one to make room.`,
        );
      }

      const last = await this.prisma.projectStar.findFirst({
        where: { userId: actor.userId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });

      await this.prisma.projectStar.create({
        data: { projectId, userId: actor.userId, position: (last?.position ?? 0) + STEP },
      });
    }

    return this.list(workspaceId, actor);
  }

  async unstar(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<StarredProject[]> {
    // No visibility check: taking a bookmark off a project you can no longer
    // see is still yours to do, and reveals nothing about it.
    await this.prisma.projectStar.deleteMany({
      where: { projectId, userId: actor.userId, project: { workspaceId } },
    });
    return this.list(workspaceId, actor);
  }

  private async requireVisible(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<void> {
    const access = await this.access.findAccess(workspaceId, projectId, actor);
    if (!access) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
    }
  }
}
