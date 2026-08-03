import {
  ActivityAction,
  ActivityEntity,
  MAX_SECTIONS_PER_PROJECT,
  ServerEvent,
} from '@coretask/contracts';
import type { Section } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { planPlacement, type OrderedItem } from '../../common/utils/position.util';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectsService } from '../projects/projects.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';

import type { CreateSectionDto, MoveSectionDto, UpdateSectionDto } from './dto/section.dto';
import { sectionInclude, toSectionDto, type SectionWithCount } from './section.mapper';

@Injectable()
export class SectionsService {
  private readonly logger = new Logger(SectionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly activity: ActivityLogsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(workspaceId: string, projectId: string): Promise<Section[]> {
    await this.projects.requireProject(workspaceId, projectId);

    const sections = await this.prisma.section.findMany({
      where: { workspaceId, projectId },
      orderBy: { position: 'asc' },
      include: sectionInclude,
    });

    return sections.map(toSectionDto);
  }

  async create(
    workspaceId: string,
    userId: string,
    projectId: string,
    dto: CreateSectionDto,
  ): Promise<Section> {
    await this.projects.requireProject(workspaceId, projectId);

    const siblings = await this.siblings(workspaceId, projectId);

    if (siblings.length >= MAX_SECTIONS_PER_PROJECT) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A project can have at most ${MAX_SECTIONS_PER_PROJECT} sections.`,
      );
    }

    if (dto.afterSectionId) {
      this.assertSibling(siblings, dto.afterSectionId);
    }

    const plan = planPlacement(siblings, dto.afterSectionId);

    const created = await this.prisma.$transaction(async (tx) => {
      await this.applyRebalance(tx, plan.rebalance);

      return tx.section.create({
        data: { workspaceId, projectId, name: dto.name, position: plan.position },
        include: sectionInclude,
      });
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.SECTION,
      entityId: created.id,
      summary: `Added section "${created.name}"`,
      metadata: { projectId },
    });

    const section = toSectionDto(created);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.SECTION_CREATED, section);

    return section;
  }

  async update(
    workspaceId: string,
    userId: string,
    projectId: string,
    sectionId: string,
    dto: UpdateSectionDto,
  ): Promise<Section> {
    const existing = await this.requireSection(workspaceId, projectId, sectionId);

    const updated = await this.prisma.section.update({
      where: { id: sectionId },
      data: { name: dto.name },
      include: sectionInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.SECTION,
      entityId: sectionId,
      summary: `Renamed section "${existing.name}" to "${updated.name}"`,
      metadata: { projectId },
    });

    const section = toSectionDto(updated);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.SECTION_UPDATED, section);

    return section;
  }

  /** Repositions a section relative to a sibling; returns the whole ordered list. */
  async move(
    workspaceId: string,
    userId: string,
    projectId: string,
    sectionId: string,
    dto: MoveSectionDto,
  ): Promise<Section[]> {
    const existing = await this.requireSection(workspaceId, projectId, sectionId);
    const siblings = await this.siblings(workspaceId, projectId);

    if (dto.afterSectionId) {
      this.assertSibling(siblings, dto.afterSectionId);
    }

    const plan = planPlacement(siblings, dto.afterSectionId, sectionId);

    await this.prisma.$transaction(async (tx) => {
      await this.applyRebalance(tx, plan.rebalance);
      await tx.section.update({ where: { id: sectionId }, data: { position: plan.position } });
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.SECTION,
      entityId: sectionId,
      summary: `Moved section "${existing.name}"`,
      metadata: { projectId, afterSectionId: dto.afterSectionId },
    });

    // The whole list, because a rebalance can change every sibling's position
    // and the client should not have to guess which ones moved.
    const ordered = await this.list(workspaceId, projectId);
    this.realtime.emitToWorkspace(workspaceId, ServerEvent.SECTION_MOVED, {
      projectId,
      sections: ordered,
    });

    return ordered;
  }

  async remove(
    workspaceId: string,
    userId: string,
    projectId: string,
    sectionId: string,
  ): Promise<{ deleted: true; reassignedTaskCount: number }> {
    const existing = await this.requireSection(workspaceId, projectId, sectionId);

    const fallback = await this.prisma.section.findFirst({
      where: { workspaceId, projectId, id: { not: sectionId } },
      orderBy: { position: 'asc' },
      select: { id: true },
    });

    const reassignedTaskCount = await this.prisma.$transaction(async (tx) => {
      // The schema's `onDelete: SetNull` would silently orphan these tasks —
      // they would vanish from the board with no way to find them again. Move
      // them to the leftmost remaining column instead.
      const { count } = await tx.task.updateMany({
        where: { sectionId },
        data: { sectionId: fallback?.id ?? null },
      });

      await tx.section.delete({ where: { id: sectionId } });
      return count;
    });

    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.DELETED,
      entity: ActivityEntity.SECTION,
      entityId: sectionId,
      summary: `Deleted section "${existing.name}"`,
      metadata: { projectId, reassignedTaskCount, movedTo: fallback?.id ?? null },
    });

    this.realtime.emitToWorkspace(workspaceId, ServerEvent.SECTION_DELETED, {
      projectId,
      sectionId,
      reassignedTaskCount,
    });
    this.logger.log({ sectionId, projectId, reassignedTaskCount }, 'Section deleted');

    return { deleted: true, reassignedTaskCount };
  }

  /**
   * Loads a section constrained to both its workspace *and* its project.
   *
   * The project id in the filter is not redundant: without it, a section id
   * from a different project in the same workspace would resolve through a URL
   * that claims otherwise.
   */
  private async requireSection(
    workspaceId: string,
    projectId: string,
    sectionId: string,
  ): Promise<SectionWithCount> {
    await this.projects.requireProject(workspaceId, projectId);

    const section = await this.prisma.section.findFirst({
      where: { id: sectionId, workspaceId, projectId },
      include: sectionInclude,
    });

    if (!section) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Section not found.');
    }

    return section;
  }

  private async siblings(workspaceId: string, projectId: string): Promise<OrderedItem[]> {
    return this.prisma.section.findMany({
      where: { workspaceId, projectId },
      orderBy: { position: 'asc' },
      select: { id: true, position: true },
    });
  }

  private assertSibling(siblings: readonly OrderedItem[], afterSectionId: string): void {
    if (!siblings.some((sibling) => sibling.id === afterSectionId)) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'The target section does not belong to this project.',
      );
    }
  }

  /** Writes the renumbered positions produced by a rebalance, if any. */
  private async applyRebalance(
    tx: Prisma.TransactionClient,
    entries: readonly OrderedItem[],
  ): Promise<void> {
    for (const entry of entries) {
      await tx.section.update({ where: { id: entry.id }, data: { position: entry.position } });
    }
  }
}
