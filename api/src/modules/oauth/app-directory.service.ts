import {
  ActivityAction,
  ActivityEntity,
  OAuthAppPolicy,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type {
  DirectoryApp,
  UnapprovedApp,
  WorkspaceAppDirectory,
  WorkspaceAppSummary,
} from '@coretask/types';
import type { ApproveWorkspaceAppInput, UpdateAppPolicyInput } from '@coretask/validation';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

const APP_SELECT = {
  id: true,
  clientId: true,
  name: true,
  description: true,
  websiteUrl: true,
  owner: { select: { name: true } },
} satisfies Prisma.OAuthAppSelect;

type AppRow = Prisma.OAuthAppGetPayload<{ select: typeof APP_SELECT }>;

const APPROVAL_SELECT = {
  createdAt: true,
  approvedBy: { select: { id: true, name: true } },
  app: { select: APP_SELECT },
} satisfies Prisma.WorkspaceOAuthAppSelect;

type ApprovalRow = Prisma.WorkspaceOAuthAppGetPayload<{ select: typeof APPROVAL_SELECT }>;

function toSummary(app: AppRow): WorkspaceAppSummary {
  return {
    id: app.id,
    clientId: app.clientId,
    name: app.name,
    description: app.description,
    websiteUrl: app.websiteUrl,
    publisher: app.owner.name,
  };
}

function toDirectoryApp(row: ApprovalRow, connectedByMe: boolean): DirectoryApp {
  return {
    app: toSummary(row.app),
    approvedAt: row.createdAt.toISOString(),
    approvedBy: row.approvedBy,
    connectedByMe,
  };
}

/**
 * A workspace's app directory: the OAuth apps its admins approved, and
 * whether only those may act in it. Changing either takes effect on the next
 * request — `WorkspaceMemberGuard` asks on every one, and webhook fan-out on
 * every event — so nobody is disconnected; an app just stops reaching here.
 */
@Injectable()
export class AppDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogsService,
  ) {}

  async get(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceAppDirectory> {
    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { oauthAppPolicy: true },
    });
    const approvals = await this.prisma.workspaceOAuthApp.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      select: APPROVAL_SELECT,
    });
    const approvedIds = approvals.map((row) => row.app.id);
    const mine = new Set(
      (
        await this.prisma.oAuthGrant.findMany({
          where: { userId, revokedAt: null, appId: { in: approvedIds } },
          select: { appId: true },
          distinct: ['appId'],
        })
      ).map((grant) => grant.appId),
    );

    return {
      policy: workspace.oauthAppPolicy,
      apps: approvals.map((row) => toDirectoryApp(row, mine.has(row.app.id))),
      unapproved: hasAtLeastRole(role, WorkspaceRole.ADMIN)
        ? await this.unapproved(workspaceId, approvedIds)
        : [],
    };
  }

  async setPolicy(
    workspaceId: string,
    userId: string,
    input: UpdateAppPolicyInput,
  ): Promise<WorkspaceAppDirectory> {
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { oauthAppPolicy: input.policy },
    });
    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary:
        input.policy === OAuthAppPolicy.APPROVED
          ? 'Allowed only approved apps'
          : 'Allowed any app members connect',
      metadata: { oauthAppPolicy: input.policy },
    });
    return this.get(workspaceId, userId, WorkspaceRole.ADMIN);
  }

  /** By client id, the name an app goes by in its authorization links. Approving twice is fine. */
  async approve(
    workspaceId: string,
    userId: string,
    input: ApproveWorkspaceAppInput,
  ): Promise<DirectoryApp> {
    const app = await this.prisma.oAuthApp.findUnique({
      where: { clientId: input.clientId },
      select: { id: true, name: true },
    });
    if (!app) throw AppException.notFound('OAUTH_UNKNOWN_CLIENT');

    const row = await this.prisma.workspaceOAuthApp.upsert({
      where: { workspaceId_appId: { workspaceId, appId: app.id } },
      create: { workspaceId, appId: app.id, approvedById: userId },
      update: {},
      select: APPROVAL_SELECT,
    });
    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: `Approved the app "${app.name}"`,
      metadata: { oauthAppId: app.id },
    });

    const connected = await this.prisma.oAuthGrant.count({
      where: { userId, appId: app.id, revokedAt: null },
    });
    return toDirectoryApp(row, connected > 0);
  }

  async remove(workspaceId: string, userId: string, appId: string): Promise<void> {
    const row = await this.prisma.workspaceOAuthApp.findUnique({
      where: { workspaceId_appId: { workspaceId, appId } },
      select: { id: true, app: { select: { name: true } } },
    });
    if (!row) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'That app is not in the directory.');
    }

    await this.prisma.workspaceOAuthApp.delete({ where: { id: row.id } });
    await this.activity.record({
      workspaceId,
      actorId: userId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.WORKSPACE,
      entityId: workspaceId,
      summary: `Removed the app "${row.app.name}" from the directory`,
      metadata: { oauthAppId: appId },
    });
  }

  /**
   * Apps the workspace's members have live connections to that the directory
   * does not hold: under `APPROVED` these are refused here, so an admin sees
   * what is knocking. Most-connected first.
   */
  private async unapproved(workspaceId: string, approvedIds: string[]): Promise<UnapprovedApp[]> {
    const grants = await this.prisma.oAuthGrant.findMany({
      where: {
        revokedAt: null,
        appId: { notIn: approvedIds },
        user: { memberships: { some: { workspaceId } } },
      },
      select: { userId: true, app: { select: APP_SELECT } },
    });

    const byApp = new Map<string, { app: AppRow; people: Set<string> }>();
    for (const grant of grants) {
      const entry = byApp.get(grant.app.id) ?? { app: grant.app, people: new Set<string>() };
      entry.people.add(grant.userId);
      byApp.set(grant.app.id, entry);
    }

    return [...byApp.values()]
      .map((entry) => ({ app: toSummary(entry.app), members: entry.people.size }))
      .sort((a, b) => b.members - a.members || a.app.name.localeCompare(b.app.name));
  }
}
