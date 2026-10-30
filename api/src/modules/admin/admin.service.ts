import {
  AttachmentStatus,
  AutomationExecutionStatus,
  AutomationRuleStatus,
  CLOSED_TASK_STATUSES,
  CLOSED_TICKET_STATUSES,
  WORKSPACE_ROLES,
  WorkspaceRole,
} from '@coretask/contracts';
import type {
  AdminMember,
  AdminMemberStatus,
  AdminOverview,
  AdminSignInMethod,
  AdminTeam,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';

const DAY_MS = 86_400_000;

/** Tasks as Home and the task list count them: subtasks are part of their parent. */
const TOP_LEVEL = { parentTaskId: null, parentTicketId: null } as const;

const MEMBER_SELECT = {
  id: true,
  role: true,
  joinedAt: true,
  deactivatedAt: true,
  invitedBy: { select: { id: true, name: true } },
  deactivatedBy: { select: { id: true, name: true } },
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      avatarUrl: true,
      jobTitle: true,
      lastLoginAt: true,
      totpEnabledAt: true,
      emailVerifiedAt: true,
      identities: { select: { provider: true } },
    },
  },
} as const;

/**
 * What the admin console reads: the workspace as a whole, for its super admins.
 *
 * Read-only on purpose. Changing a membership goes through `MembersService`,
 * so the console and the Members page can never apply different rules.
 */
@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every person with a membership here, deactivated ones included, with what
   * a super admin needs to decide about them. The service account behind an
   * API key is not a person and is left out.
   */
  async listMembers(workspaceId: string, memberId?: string): Promise<AdminMember[]> {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, user: { isServiceAccount: false }, ...(memberId && { id: memberId }) },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      select: MEMBER_SELECT,
    });
    if (rows.length === 0) return [];

    const userIds = rows.map((row) => row.user.id);
    const open = { workspaceId, assigneeId: { in: userIds } };
    const [withPassword, sessions, tasks, tickets] = await Promise.all([
      // Asked as a question, so no password hash is ever read into this service.
      this.prisma.user.findMany({
        where: { id: { in: userIds }, passwordHash: { not: null } },
        select: { id: true },
      }),
      // Every refresh writes a row, so the newest one is when they were last about.
      this.prisma.refreshToken.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds } },
        _max: { createdAt: true },
      }),
      this.prisma.task.groupBy({
        by: ['assigneeId'],
        where: { ...open, status: { notIn: [...CLOSED_TASK_STATUSES] } },
        _count: { _all: true },
      }),
      this.prisma.ticket.groupBy({
        by: ['assigneeId'],
        where: { ...open, status: { notIn: [...CLOSED_TICKET_STATUSES] } },
        _count: { _all: true },
      }),
    ]);

    const hasPassword = new Set(withPassword.map((user) => user.id));
    const lastSession = new Map(sessions.map((row) => [row.userId, row._max.createdAt]));
    const openTasks = new Map(tasks.map((row) => [row.assigneeId, row._count._all]));
    const openTickets = new Map(tickets.map((row) => [row.assigneeId, row._count._all]));

    return rows.map((row) => {
      const { user } = row;
      const methods: AdminSignInMethod[] = [
        ...(hasPassword.has(user.id) ? (['PASSWORD'] as const) : []),
        ...new Set(user.identities.map((identity) => identity.provider)),
      ];
      const lastActive = latest(user.lastLoginAt, lastSession.get(user.id) ?? null);
      const status: AdminMemberStatus = row.deactivatedAt
        ? 'DEACTIVATED'
        : methods.length === 0 && !lastActive
          ? 'NOT_SIGNED_UP'
          : 'ACTIVE';

      return {
        id: row.id,
        role: row.role,
        status,
        joinedAt: row.joinedAt.toISOString(),
        invitedBy: row.invitedBy,
        deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
        deactivatedBy: row.deactivatedBy,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          jobTitle: user.jobTitle,
          lastActiveAt: lastActive?.toISOString() ?? null,
          twoFactorEnabled: user.totpEnabledAt !== null,
          emailVerified: user.emailVerifiedAt !== null,
          signInMethods: methods,
        },
        openTasks: openTasks.get(user.id) ?? 0,
        openTickets: openTickets.get(user.id) ?? 0,
      };
    });
  }

  async readMember(workspaceId: string, memberId: string): Promise<AdminMember> {
    const [member] = await this.listMembers(workspaceId, memberId);
    if (!member) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Member not found.');
    return member;
  }

  /** Every team, with the counts the console lists. Teams have no privacy to respect. */
  async listTeams(workspaceId: string): Promise<AdminTeam[]> {
    const teams = await this.prisma.team.findMany({
      where: { workspaceId },
      orderBy: { name: 'asc' },
      include: {
        lead: { select: { id: true, name: true, avatarUrl: true } },
        _count: { select: { members: true, projects: true } },
      },
    });

    return teams.map((team) => ({
      id: team.id,
      name: team.name,
      description: team.description,
      color: team.color,
      lead: team.lead,
      memberCount: team._count.members,
      projectCount: team._count.projects,
      createdAt: team.createdAt.toISOString(),
    }));
  }

  /** The console's front page: the workspace in numbers. */
  async overview(workspaceId: string): Promise<AdminOverview> {
    const now = Date.now();
    const since7 = new Date(now - 7 * DAY_MS);
    const since30 = new Date(now - 30 * DAY_MS);

    const [
      workspace,
      members,
      pendingInvitations,
      expiredInvitations,
      teams,
      activeProjects,
      archivedProjects,
      openTasks,
      createdTasks,
      completedTasks,
      storage,
      activeRules,
      runs,
      failedRuns,
      saml,
      verifiedDomains,
      lastImport,
      liveSync,
    ] = await Promise.all([
      this.prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { id: true, name: true, createdAt: true },
      }),
      this.listMembers(workspaceId),
      this.prisma.workspaceInvitation.count({
        where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date(now) } },
      }),
      this.prisma.workspaceInvitation.count({
        where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { lte: new Date(now) } },
      }),
      this.prisma.team.count({ where: { workspaceId } }),
      this.prisma.project.count({ where: { workspaceId, archivedAt: null } }),
      this.prisma.project.count({ where: { workspaceId, archivedAt: { not: null } } }),
      this.prisma.task.count({
        where: {
          workspaceId,
          ...TOP_LEVEL,
          archivedAt: null,
          status: { notIn: [...CLOSED_TASK_STATUSES] },
        },
      }),
      this.prisma.task.count({ where: { workspaceId, ...TOP_LEVEL, createdAt: { gte: since30 } } }),
      this.prisma.task.count({
        where: { workspaceId, ...TOP_LEVEL, completedAt: { gte: since30 } },
      }),
      this.prisma.attachment.aggregate({
        where: { workspaceId, status: AttachmentStatus.READY },
        _count: { _all: true },
        _sum: { sizeBytes: true },
      }),
      this.prisma.automationRule.count({
        where: { workspaceId, status: AutomationRuleStatus.ACTIVE },
      }),
      this.prisma.automationExecution.count({
        where: { workspaceId, startedAt: { gte: since7 } },
      }),
      this.prisma.automationExecution.count({
        where: {
          workspaceId,
          startedAt: { gte: since7 },
          status: {
            in: [AutomationExecutionStatus.FAILED, AutomationExecutionStatus.PARTIALLY_FAILED],
          },
        },
      }),
      this.prisma.samlConnection.findUnique({
        where: { workspaceId },
        select: { enabled: true },
      }),
      this.prisma.workspaceDomain.findMany({
        where: { workspaceId, verifiedAt: { not: null } },
        orderBy: { domain: 'asc' },
        select: { domain: true },
      }),
      this.prisma.importRun.findFirst({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, startedAt: true, finishedAt: true },
      }),
      this.prisma.asanaLiveSync.findUnique({
        where: { workspaceId },
        select: { enabled: true },
      }),
    ]);

    const byRole = Object.fromEntries(WORKSPACE_ROLES.map((role) => [role, 0])) as Record<
      WorkspaceRole,
      number
    >;
    for (const member of members) byRole[member.role] += 1;
    const activeSince = (since: Date) =>
      members.filter(
        (member) =>
          member.status !== 'DEACTIVATED' &&
          member.user.lastActiveAt !== null &&
          new Date(member.user.lastActiveAt) >= since,
      ).length;
    const owner = members.find((member) => member.role === WorkspaceRole.OWNER);

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt.toISOString(),
        owner: owner
          ? { id: owner.user.id, name: owner.user.name, email: owner.user.email }
          : null,
      },
      people: {
        total: members.length,
        active: members.filter((member) => member.status === 'ACTIVE').length,
        deactivated: members.filter((member) => member.status === 'DEACTIVATED').length,
        notSignedUp: members.filter((member) => member.status === 'NOT_SIGNED_UP').length,
        byRole,
        activeLast7Days: activeSince(since7),
        activeLast30Days: activeSince(since30),
        twoFactorEnabled: members.filter(
          (member) => member.status !== 'DEACTIVATED' && member.user.twoFactorEnabled,
        ).length,
      },
      invitations: { pending: pendingInvitations, expired: expiredInvitations },
      teams,
      projects: { active: activeProjects, archived: archivedProjects },
      tasks: {
        open: openTasks,
        createdLast30Days: createdTasks,
        completedLast30Days: completedTasks,
      },
      storage: { files: storage._count._all, bytes: storage._sum.sizeBytes ?? 0 },
      automations: { active: activeRules, runsLast7Days: runs, failedLast7Days: failedRuns },
      sso: {
        configured: saml !== null,
        enabled: saml?.enabled ?? false,
        verifiedDomains: verifiedDomains.map((row) => row.domain),
      },
      asana:
        lastImport || liveSync
          ? {
              liveSync: liveSync?.enabled ?? false,
              lastRun: lastImport
                ? {
                    status: lastImport.status,
                    startedAt: lastImport.startedAt?.toISOString() ?? null,
                    finishedAt: lastImport.finishedAt?.toISOString() ?? null,
                  }
                : null,
            }
          : null,
    };
  }
}

function latest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
