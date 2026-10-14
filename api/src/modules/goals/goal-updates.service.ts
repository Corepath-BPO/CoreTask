import {
  ActivityEntity,
  GOAL_STATUS_LABEL,
  NotificationType,
  WorkspaceRole,
  hasAtLeastRole,
  type GoalStatus,
} from '@coretask/contracts';
import type { GoalUpdate, PostGoalUpdatePayload } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { htmlToText, normalizeRichText } from '../../common/utils/rich-text.util';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';

import { GoalsService } from './goals.service';

const updateInclude = {
  author: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.GoalUpdateInclude;

type UpdateRow = Prisma.GoalUpdateGetPayload<{ include: typeof updateInclude }>;

const toDto = (row: UpdateRow): GoalUpdate => ({
  id: row.id,
  goalId: row.goalId,
  status: row.status as GoalStatus,
  progress: row.progress,
  body: row.body,
  author: row.author,
  createdAt: row.createdAt.toISOString(),
});

/** Updates a goal keeps; older ones fall off the list, not the database. */
const UPDATES_SHOWN = 50;

/**
 * Goal status updates — Asana's goal check-ins. Each is a status, a note and
 * the progress at that moment; the newest sets the goal's status, so the
 * history reads as how the goal has been going. Members post; the author or
 * a manager deletes. The owner hears of an update someone else posts.
 */
@Injectable()
export class GoalUpdatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goals: GoalsService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async list(workspaceId: string, actor: ActorContext, goalId: string): Promise<GoalUpdate[]> {
    await this.goals.get(workspaceId, actor, goalId);
    const rows = await this.prisma.goalUpdate.findMany({
      where: { goalId },
      include: updateInclude,
      orderBy: { createdAt: 'desc' },
      take: UPDATES_SHOWN,
    });
    return rows.map(toDto);
  }

  async post(
    workspaceId: string,
    actor: ActorContext,
    goalId: string,
    payload: PostGoalUpdatePayload,
  ): Promise<GoalUpdate> {
    if (!hasAtLeastRole(actor.role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'Guests can read goal updates, not post them.');
    }
    const goal = await this.goals.get(workspaceId, actor, goalId);
    const body = normalizeRichText(payload.body ?? '') ?? '';

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.goalUpdate.create({
        data: {
          workspaceId,
          goalId,
          authorId: actor.userId,
          status: payload.status,
          progress: goal.progress,
          body,
        },
        include: updateInclude,
      });
      await tx.goal.update({ where: { id: goalId }, data: { status: payload.status } });
      return created;
    });

    if (goal.owner && goal.owner.id !== actor.userId) {
      await this.notifications.dispatch({
        userId: goal.owner.id,
        workspaceId,
        type: NotificationType.PROJECT_UPDATE,
        title:
          `${row.author?.name ?? 'Somebody'} updated “${goal.name}”: ${GOAL_STATUS_LABEL[payload.status]}`.slice(
            0,
            200,
          ),
        body: htmlToText(body).slice(0, 200),
        entity: ActivityEntity.WORKSPACE,
        entityId: workspaceId,
        actionUrl: `/goals?goal=${goalId}`,
      });
    }

    return toDto(row);
  }

  async remove(
    workspaceId: string,
    actor: ActorContext,
    goalId: string,
    updateId: string,
  ): Promise<void> {
    await this.goals.get(workspaceId, actor, goalId);
    const row = await this.prisma.goalUpdate.findFirst({
      where: { id: updateId, goalId, workspaceId },
      select: { id: true, authorId: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Update not found.');
    if (row.authorId !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden('FORBIDDEN', 'Only its author or a manager can delete it.');
    }
    await this.prisma.goalUpdate.delete({ where: { id: row.id } });
  }
}
