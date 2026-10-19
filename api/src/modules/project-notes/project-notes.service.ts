import { WorkspaceRole } from '@coretask/contracts';
import type { ProjectNote } from '@coretask/types';
import { Injectable } from '@nestjs/common';

import type { ActorContext } from '../../common/types/api.types';
import { normalizeRichText } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

/** Characters a note may hold once sanitised: a long document, not a book. */
const NOTE_MAX = 200_000;

/**
 * A project's Note — Asana's project page: one rich-text document anyone who
 * can open the project reads and its editors write, saved as they type. The
 * last writer wins, as in a shared doc without live cursors; the page says
 * who changed it last.
 */
@Injectable()
export class ProjectNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async get(workspaceId: string, projectId: string, actor: ActorContext): Promise<ProjectNote> {
    await this.access.resolveAccess(workspaceId, projectId, actor);
    return this.read(projectId);
  }

  async save(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    raw: string,
  ): Promise<ProjectNote> {
    await this.access.requireAccess(workspaceId, projectId, actor, WorkspaceRole.MEMBER);
    const body = (normalizeRichText(raw) ?? '').slice(0, NOTE_MAX);
    await this.prisma.projectNote.upsert({
      where: { projectId },
      create: { projectId, workspaceId, body, updatedById: actor.userId },
      update: { body, updatedById: actor.userId },
    });
    return this.read(projectId);
  }

  private async read(projectId: string): Promise<ProjectNote> {
    const row = await this.prisma.projectNote.findUnique({
      where: { projectId },
      include: { updatedBy: { select: { id: true, name: true } } },
    });
    return {
      body: row?.body ?? '',
      updatedBy: row?.updatedBy ?? null,
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
}
