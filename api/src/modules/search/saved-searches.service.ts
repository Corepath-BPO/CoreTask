import { MAX_SAVED_SEARCHES, readTaskSearchFilters } from '@coretask/contracts';
import type { SavedSearch, SaveSearchPayload, UpdateSavedSearchPayload } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma, SavedSearch as SavedSearchRow } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';

function toDto(row: SavedSearchRow): SavedSearch {
  return {
    id: row.id,
    name: row.name,
    filters: readTaskSearchFilters(row.filters),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Saved searches: a person's own, listed in their sidebar. Nobody else sees
 * them — "assigned to me" would mean someone else anyway.
 */
@Injectable()
export class SavedSearchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, actor: ActorContext): Promise<SavedSearch[]> {
    const rows = await this.prisma.savedSearch.findMany({
      where: { workspaceId, userId: actor.userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(
    workspaceId: string,
    actor: ActorContext,
    payload: SaveSearchPayload,
  ): Promise<SavedSearch> {
    const count = await this.prisma.savedSearch.count({
      where: { workspaceId, userId: actor.userId },
    });
    if (count >= MAX_SAVED_SEARCHES) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `You can keep up to ${MAX_SAVED_SEARCHES} saved searches.`,
      );
    }
    const row = await this.prisma.savedSearch.create({
      data: {
        workspaceId,
        userId: actor.userId,
        name: payload.name.trim(),
        filters: readTaskSearchFilters(payload.filters) as Prisma.InputJsonValue,
      },
    });
    return toDto(row);
  }

  async update(
    workspaceId: string,
    actor: ActorContext,
    searchId: string,
    payload: UpdateSavedSearchPayload,
  ): Promise<SavedSearch> {
    await this.requireOwn(workspaceId, actor, searchId);
    const row = await this.prisma.savedSearch.update({
      where: { id: searchId },
      data: {
        ...(payload.name !== undefined ? { name: payload.name.trim() } : {}),
        ...(payload.filters !== undefined
          ? { filters: readTaskSearchFilters(payload.filters) as Prisma.InputJsonValue }
          : {}),
      },
    });
    return toDto(row);
  }

  async remove(workspaceId: string, actor: ActorContext, searchId: string): Promise<void> {
    await this.requireOwn(workspaceId, actor, searchId);
    await this.prisma.savedSearch.delete({ where: { id: searchId } });
  }

  private async requireOwn(workspaceId: string, actor: ActorContext, searchId: string) {
    const row = await this.prisma.savedSearch.findFirst({
      where: { id: searchId, workspaceId, userId: actor.userId },
      select: { id: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Saved search not found.');
  }
}
