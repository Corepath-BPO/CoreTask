import {
  ACTIVITY_FEED_LIMIT,
  ActivityAction,
  ITEM_ACTIVITY_PAGE_LIMIT,
  ServerEvent,
  type ActivityEntity,
} from '@coretask/contracts';
import type { ActivityEntry, ItemActivityPage } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';

import type { StoryDraft } from './item-stories';

export interface RecordActivityInput {
  workspaceId: string;
  /** Null for system-originated activity (jobs, automations). */
  actorId: string | null;
  action: ActivityAction;
  entity: ActivityEntity;
  entityId: string;
  summary: string;
  metadata?: Prisma.InputJsonValue;
}

/** Who did what to which item — shared by every story a single write produces. */
export interface StoryContext {
  workspaceId: string;
  actorId: string | null;
  entity: ActivityEntity;
  entityId: string;
}

const ACTOR_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  isServiceAccount: true,
} as const;

/**
 * Append-only audit trail.
 *
 * Writes are best-effort by design: losing an audit line is bad, but failing the
 * user's action because the audit insert failed is worse. Failures are logged at
 * error level so they surface in monitoring.
 */
@Injectable()
export class ActivityLogsService {
  private readonly logger = new Logger(ActivityLogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async record(input: RecordActivityInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;

    try {
      const entry = await client.activityLog.create({
        data: {
          workspaceId: input.workspaceId,
          actorId: input.actorId,
          action: input.action,
          entity: input.entity,
          entityId: input.entityId,
          summary: input.summary.slice(0, 500),
          ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
        },
      });

      /*
       * The panel's feed learns of a new story here rather than from each
       * writer: there is one place a line is written, so there is one place it
       * is announced. The payload names the item, not the story — a client
       * refetches the feed, which is what it would do anyway.
       */
      this.realtime.emitToWorkspace(input.workspaceId, ServerEvent.ACTIVITY_RECORDED, {
        id: entry.id,
        workspaceId: input.workspaceId,
        entity: input.entity,
        entityId: input.entityId,
        action: input.action,
        createdAt: entry.createdAt.toISOString(),
      });
    } catch (error) {
      this.logger.error({ err: error, input }, 'Failed to write activity log');
    }
  }

  /** Every story one write produced, as separate lines with one context. */
  async recordStories(
    context: StoryContext,
    stories: readonly StoryDraft[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    for (const story of stories) {
      await this.record(
        {
          ...context,
          action: story.action,
          summary: story.summary,
          metadata: story.metadata as unknown as Prisma.InputJsonValue,
        },
        tx,
      );
    }
  }

  /** Most recent activity in a workspace, newest first. */
  async listFeed(workspaceId: string, limit = ACTIVITY_FEED_LIMIT): Promise<ActivityEntry[]> {
    const entries = await this.prisma.activityLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { actor: { select: ACTOR_SELECT } },
    });

    return entries.map((entry) => this.toEntry(entry));
  }

  /**
   * One item's stories, newest first, paged by id.
   *
   * Ids are UUID v7 and therefore time-ordered, so `before` is a cursor that
   * cannot repeat or skip a line the way an offset does when a story lands
   * between two requests — the same trick the inbox uses.
   *
   * `COMMENTED` lines are left out: the comment itself is in the thread, and a
   * "commented" story beside it would say the same thing twice. So are
   * attachment stories for files that were posted *with* a comment, because
   * that comment shows them.
   */
  async listForEntity(
    workspaceId: string,
    entity: ActivityEntity,
    entityId: string,
    query: { before?: string | undefined; limit?: number | undefined } = {},
  ): Promise<ItemActivityPage> {
    const limit = Math.min(query.limit ?? ITEM_ACTIVITY_PAGE_LIMIT, ITEM_ACTIVITY_PAGE_LIMIT);

    const rows = await this.prisma.activityLog.findMany({
      where: {
        workspaceId,
        entity,
        entityId,
        action: { not: ActivityAction.COMMENTED },
        ...(query.before ? { id: { lt: query.before } } : {}),
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
      include: { actor: { select: ACTOR_SELECT } },
    });

    const page = rows.slice(0, limit);
    const kept = await this.withoutCommentAttachments(page);

    return {
      items: kept.map((entry) => this.toEntry(entry)),
      nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  private async withoutCommentAttachments<T extends { action: ActivityAction; metadata: unknown }>(
    rows: T[],
  ): Promise<T[]> {
    const attachmentIds = rows
      .filter((row) => row.action === ActivityAction.ATTACHED)
      .map((row) => (row.metadata as { attachmentId?: string } | null)?.attachmentId)
      .filter((id): id is string => typeof id === 'string');
    if (attachmentIds.length === 0) return rows;

    const posted = await this.prisma.attachment.findMany({
      where: { id: { in: attachmentIds }, commentId: { not: null } },
      select: { id: true },
    });
    if (posted.length === 0) return rows;

    const hidden = new Set(posted.map((row) => row.id));
    return rows.filter(
      (row) =>
        row.action !== ActivityAction.ATTACHED ||
        !hidden.has((row.metadata as { attachmentId?: string } | null)?.attachmentId ?? ''),
    );
  }

  private toEntry(entry: {
    id: string;
    workspaceId: string;
    action: ActivityAction;
    entity: ActivityEntity;
    entityId: string;
    summary: string;
    metadata: unknown;
    actor: {
      id: string;
      name: string;
      email: string;
      avatarUrl: string | null;
      isServiceAccount: boolean;
    } | null;
    createdAt: Date;
  }): ActivityEntry {
    return {
      id: entry.id,
      workspaceId: entry.workspaceId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      summary: entry.summary,
      metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
      actor: entry.actor,
      createdAt: entry.createdAt.toISOString(),
    };
  }
}
