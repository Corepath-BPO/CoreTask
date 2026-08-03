import { ACTIVITY_FEED_LIMIT, type ActivityAction, type ActivityEntity } from '@coretask/contracts';
import type { ActivityEntry } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordActivityInput, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;

    try {
      await client.activityLog.create({
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
    } catch (error) {
      this.logger.error({ err: error, input }, 'Failed to write activity log');
    }
  }

  /** Most recent activity in a workspace, newest first. */
  async listFeed(workspaceId: string, limit = ACTIVITY_FEED_LIMIT): Promise<ActivityEntry[]> {
    const entries = await this.prisma.activityLog.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        actor: { select: { id: true, name: true, email: true, avatarUrl: true } },
      },
    });

    return entries.map((entry) => ({
      id: entry.id,
      workspaceId: entry.workspaceId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      summary: entry.summary,
      actor: entry.actor,
      createdAt: entry.createdAt.toISOString(),
    }));
  }
}
