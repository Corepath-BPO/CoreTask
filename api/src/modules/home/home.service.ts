import { DEFAULT_HOME_WIDGETS, readHomeWidgets } from '@coretask/contracts';
import type { HomeLayout, UpdateHomeLayoutPayload } from '@coretask/types';
import { Injectable } from '@nestjs/common';

import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';

/**
 * Home — each person's own arrangement of their Home page, per workspace,
 * and their private notepad. Nobody else reads it or changes it, so the only
 * check is the workspace membership the guard already made.
 */
@Injectable()
export class HomeService {
  constructor(private readonly prisma: PrismaService) {}

  async get(workspaceId: string, actor: ActorContext): Promise<HomeLayout> {
    const row = await this.prisma.homeLayout.findUnique({
      where: { userId_workspaceId: { userId: actor.userId, workspaceId } },
    });
    return row
      ? { widgets: readHomeWidgets(row.widgets), notepad: row.notepad, customized: true }
      : { widgets: [...DEFAULT_HOME_WIDGETS], notepad: '', customized: false };
  }

  async update(
    workspaceId: string,
    actor: ActorContext,
    payload: UpdateHomeLayoutPayload,
  ): Promise<HomeLayout> {
    const widgets = payload.widgets !== undefined ? readHomeWidgets(payload.widgets) : undefined;

    const row = await this.prisma.homeLayout.upsert({
      where: { userId_workspaceId: { userId: actor.userId, workspaceId } },
      create: {
        userId: actor.userId,
        workspaceId,
        widgets: widgets ?? [...DEFAULT_HOME_WIDGETS],
        notepad: payload.notepad ?? '',
      },
      update: {
        ...(widgets !== undefined ? { widgets } : {}),
        ...(payload.notepad !== undefined ? { notepad: payload.notepad } : {}),
      },
    });
    return { widgets: readHomeWidgets(row.widgets), notepad: row.notepad, customized: true };
  }

  /** Back to the defaults. The notepad is theirs and stays. */
  async reset(workspaceId: string, actor: ActorContext): Promise<HomeLayout> {
    const row = await this.prisma.homeLayout.findUnique({
      where: { userId_workspaceId: { userId: actor.userId, workspaceId } },
      select: { notepad: true },
    });
    if (!row) return this.get(workspaceId, actor);

    if (row.notepad === '') {
      await this.prisma.homeLayout.delete({
        where: { userId_workspaceId: { userId: actor.userId, workspaceId } },
      });
      return this.get(workspaceId, actor);
    }
    return this.update(workspaceId, actor, { widgets: [...DEFAULT_HOME_WIDGETS] });
  }
}
