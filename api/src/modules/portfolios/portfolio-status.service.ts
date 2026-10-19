import {
  ActivityEntity,
  NotificationType,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type {
  PortfolioStatusUpdate,
  PostStatusUpdatePayload,
  StatusRequestResult,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { askedRecently } from '../project-updates/status-request';

const include = {
  author: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.PortfolioStatusUpdateInclude;

type Row = Prisma.PortfolioStatusUpdateGetPayload<{ include: typeof include }>;

/** How many of a portfolio's updates its Progress tab shows. */
const HISTORY = 50;

/** Read in a notification: "At risk", "On hold". */
const STATUS_LABEL: Record<string, string> = {
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OFF_TRACK: 'Off track',
  ON_HOLD: 'On hold',
  COMPLETE: 'Complete',
  DROPPED: 'Dropped',
};

function toDto(row: Row): PortfolioStatusUpdate {
  return {
    id: row.id,
    portfolioId: row.portfolioId,
    status: row.status,
    title: row.title,
    summary: row.summary,
    nextSteps: row.nextSteps,
    author: row.author,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Status updates on a portfolio as a whole — Asana's portfolio status, beside
 * the per-project ones its Progress tab rolls up. Anyone in the workspace
 * reads them, as they read the portfolio. Posting is the owner's or a
 * manager's, the same people who change the portfolio; the newest is the
 * portfolio's status. The owner and whoever starred it hear about each one.
 */
@Injectable()
export class PortfolioStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  async list(workspaceId: string, portfolioId: string): Promise<PortfolioStatusUpdate[]> {
    await this.requirePortfolio(workspaceId, portfolioId);
    const rows = await this.prisma.portfolioStatusUpdate.findMany({
      where: { portfolioId },
      include,
      orderBy: { createdAt: 'desc' },
      take: HISTORY,
    });
    return rows.map(toDto);
  }

  async post(
    workspaceId: string,
    portfolioId: string,
    actor: ActorContext,
    payload: PostStatusUpdatePayload,
  ): Promise<PortfolioStatusUpdate> {
    const portfolio = await this.requirePortfolio(workspaceId, portfolioId);
    if (portfolio.ownerId !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only the portfolio’s owner or a manager can set its status.',
      );
    }

    const row = await this.prisma.portfolioStatusUpdate.create({
      data: {
        workspaceId,
        portfolioId,
        authorId: actor.userId,
        status: payload.status,
        title: payload.title.trim(),
        summary: payload.summary?.trim() || null,
        nextSteps: payload.nextSteps?.trim() || null,
      },
      include,
    });

    const stars = await this.prisma.portfolioStar.findMany({
      where: { portfolioId },
      select: { userId: true },
    });
    const audience = new Set(
      [portfolio.ownerId, ...stars.map((star) => star.userId)].filter(
        (id): id is string => id !== null && id !== actor.userId,
      ),
    );
    for (const userId of audience) {
      await this.notifications.dispatch({
        userId,
        workspaceId,
        type: NotificationType.PROJECT_UPDATE,
        title: `${row.author?.name ?? 'Somebody'} set ${portfolio.name} to ${
          STATUS_LABEL[row.status] ?? row.status
        }`.slice(0, 200),
        body: row.summary?.slice(0, 200) ?? row.title,
        entity: ActivityEntity.WORKSPACE,
        entityId: workspaceId,
        actionUrl: `/portfolios/${portfolioId}/progress`,
      });
    }

    return toDto(row);
  }

  /** "Request status update": tells the portfolio's owner someone wants one. */
  async request(
    workspaceId: string,
    portfolioId: string,
    actor: ActorContext,
  ): Promise<StatusRequestResult> {
    const portfolio = await this.requirePortfolio(workspaceId, portfolioId);
    const owner = portfolio.ownerId
      ? await this.prisma.user.findUnique({
          where: { id: portfolio.ownerId },
          select: { id: true, name: true },
        })
      : null;
    if (!owner) {
      throw AppException.badRequest('BAD_REQUEST', 'This portfolio has no owner to ask.');
    }
    if (owner.id === actor.userId) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'You own this portfolio — set its status yourself.',
      );
    }
    const asker = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.userId },
      select: { name: true },
    });
    const title = `${asker.name} asked for a status update on ${portfolio.name}`.slice(0, 200);
    if (!(await askedRecently(this.prisma, owner.id, title))) {
      await this.notifications.dispatch({
        userId: owner.id,
        workspaceId,
        type: NotificationType.PROJECT_UPDATE,
        title,
        body: 'Set the portfolio’s status from its header.',
        entity: ActivityEntity.WORKSPACE,
        entityId: workspaceId,
        actionUrl: `/portfolios/${portfolioId}/progress`,
      });
    }
    return { recipient: owner };
  }

  async remove(
    workspaceId: string,
    portfolioId: string,
    updateId: string,
    actor: ActorContext,
  ): Promise<void> {
    await this.requirePortfolio(workspaceId, portfolioId);
    const row = await this.prisma.portfolioStatusUpdate.findFirst({
      where: { id: updateId, portfolioId, workspaceId },
      select: { id: true, authorId: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Status update not found.');
    if (row.authorId !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden('FORBIDDEN', 'Only its author or a manager can delete it.');
    }
    await this.prisma.portfolioStatusUpdate.delete({ where: { id: row.id } });
  }

  private async requirePortfolio(workspaceId: string, portfolioId: string) {
    const portfolio = await this.prisma.portfolio.findFirst({
      where: { id: portfolioId, workspaceId },
      select: { id: true, name: true, ownerId: true },
    });
    if (!portfolio) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Portfolio not found.');
    return portfolio;
  }
}
