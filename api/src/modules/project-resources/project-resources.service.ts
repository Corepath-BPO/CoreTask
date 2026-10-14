import { MAX_PROJECT_RESOURCES, WorkspaceRole } from '@coretask/contracts';
import type { AddProjectResourcePayload, ProjectResource } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

const resourceInclude = {
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.ProjectResourceInclude;

type ResourceRow = Prisma.ProjectResourceGetPayload<{ include: typeof resourceInclude }>;

const toDto = (row: ResourceRow): ProjectResource => ({
  id: row.id,
  title: row.title,
  url: row.url,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
});

/** Only web addresses: a `javascript:` link on a shared page is a trap for whoever clicks it. */
function webUrl(raw: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    throw AppException.badRequest('BAD_REQUEST', 'That is not a web address.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw AppException.badRequest('BAD_REQUEST', 'Only http and https links can be added.');
  }
  return parsed.toString();
}

/**
 * A project's key resources — Asana's Overview "Key resources": the links
 * everyone on the project should have to hand. Whoever can open the project
 * sees them; its editors add, reorder and remove them.
 */
@Injectable()
export class ProjectResourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async list(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ProjectResource[]> {
    await this.access.resolveAccess(workspaceId, projectId, actor);
    return this.read(projectId);
  }

  async add(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    payload: AddProjectResourcePayload,
  ): Promise<ProjectResource[]> {
    await this.access.requireAccess(workspaceId, projectId, actor, WorkspaceRole.MEMBER);
    const url = webUrl(payload.url);
    const existing = await this.prisma.projectResource.findMany({
      where: { projectId },
      select: { position: true },
      orderBy: { position: 'desc' },
    });
    if (existing.length >= MAX_PROJECT_RESOURCES) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A project keeps up to ${MAX_PROJECT_RESOURCES} key resources.`,
      );
    }
    await this.prisma.projectResource.create({
      data: {
        workspaceId,
        projectId,
        title: payload.title.trim() || new URL(url).hostname,
        url,
        position: (existing[0]?.position ?? 0) + 1,
        createdById: actor.userId,
      },
    });
    return this.read(projectId);
  }

  async remove(
    workspaceId: string,
    projectId: string,
    resourceId: string,
    actor: ActorContext,
  ): Promise<ProjectResource[]> {
    await this.access.requireAccess(workspaceId, projectId, actor, WorkspaceRole.MEMBER);
    const removed = await this.prisma.projectResource.deleteMany({
      where: { id: resourceId, projectId },
    });
    if (removed.count === 0)
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Resource not found.');
    return this.read(projectId);
  }

  private async read(projectId: string): Promise<ProjectResource[]> {
    const rows = await this.prisma.projectResource.findMany({
      where: { projectId },
      include: resourceInclude,
      orderBy: { position: 'asc' },
    });
    return rows.map(toDto);
  }
}
