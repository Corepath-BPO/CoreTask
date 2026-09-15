import {
  ActivityAction,
  ActivityEntity,
  NotificationType,
  ProjectMemberRole,
  ProjectVisibility,
  ServerEvent,
  defaultJoinRole,
  hasProjectAdminOverride,
} from '@coretask/contracts';
import type { ProjectMember } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext, ProjectAccessContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { ProjectBroadcastService } from '../../websocket/project-broadcast.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { WorkspaceMembersService } from '../workspace-members/workspace-members.service';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  isServiceAccount: true,
} as const;

const memberInclude = { user: { select: USER_SELECT } } satisfies Prisma.ProjectMemberInclude;

type MemberRow = Prisma.ProjectMemberGetPayload<{ include: typeof memberInclude }>;

/**
 * A project's roster.
 *
 * Every change runs inside a transaction that first locks the project row, so
 * two admins demoting each other at the same moment cannot both count two
 * admins and leave a private project with none — the same reasoning as the
 * ticket counter lock. Reads need no such care.
 */
@Injectable()
export class ProjectMembersService {
  private readonly logger = new Logger(ProjectMembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: WorkspaceMembersService,
    private readonly activity: ActivityLogsService,
    private readonly notifications: NotificationDispatcher,
    private readonly realtime: RealtimeGateway,
    private readonly broadcast: ProjectBroadcastService,
  ) {}

  /** Admins first, then in the order they were added — the order a Share dialog shows. */
  async list(projectId: string): Promise<ProjectMember[]> {
    const rows = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: memberInclude,
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });

    return rows.map(toMemberDto);
  }

  /**
   * Adds a workspace member to the roster. Someone already on it keeps the
   * role they have — adding is not the way to demote, and a second add from a
   * stale dialog must not undo a promotion.
   */
  async add(
    access: ProjectAccessContext,
    actor: ActorContext,
    userId: string,
    role: ProjectMemberRole = ProjectMemberRole.EDITOR,
  ): Promise<ProjectMember> {
    const { workspaceId, projectId } = access;
    await this.assertWorkspaceMember(workspaceId, userId);

    const { row, created } = await this.prisma.$transaction(async (tx) => {
      await this.lockProject(tx, projectId);

      const existing = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        include: memberInclude,
      });
      if (existing) return { row: existing, created: false };

      const inserted = await tx.projectMember.create({
        data: { projectId, workspaceId, userId, role, addedById: actor.userId },
        include: memberInclude,
      });
      return { row: inserted, created: true };
    });

    if (created) {
      const project = await this.projectName(projectId);
      const self = userId === actor.userId;

      await this.activity.record({
        workspaceId,
        actorId: actor.userId,
        action: ActivityAction.MEMBER_ADDED,
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        projectId,
        summary: self
          ? `Joined project "${project}"`
          : `Added ${row.user.name} to project "${project}"`,
        metadata: { userId, role, self },
      });

      if (!self) {
        const actorName = await this.userName(actor.userId);
        await this.notifications.dispatch({
          userId,
          workspaceId,
          type: NotificationType.PROJECT_MEMBER_ADDED,
          title: `${actorName} added you to ${project}`,
          body: `You are ${describeRole(role)}.`,
          entity: ActivityEntity.PROJECT,
          entityId: projectId,
          actionUrl: `/projects/${projectId}`,
        });
      }

      this.announce(ServerEvent.PROJECT_MEMBER_ADDED, access, toMemberDto(row));
      this.broadcast.grant(workspaceId, projectId, [userId]);
      this.logger.log({ projectId, userId, role }, 'Project member added');
    }

    return toMemberDto(row);
  }

  async updateRole(
    access: ProjectAccessContext,
    actor: ActorContext,
    userId: string,
    role: ProjectMemberRole,
  ): Promise<ProjectMember> {
    const { workspaceId, projectId } = access;

    const { row, changed, previous } = await this.prisma.$transaction(async (tx) => {
      await this.lockProject(tx, projectId);

      const existing = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        include: memberInclude,
      });
      if (!existing) {
        throw AppException.notFound('RESOURCE_NOT_FOUND', 'They are not a member of this project.');
      }
      if (existing.role === role) return { row: existing, changed: false, previous: role };

      if (existing.role === ProjectMemberRole.ADMIN) {
        await this.assertNotLastAdmin(tx, access);
      }

      const updated = await tx.projectMember.update({
        where: { projectId_userId: { projectId, userId } },
        data: { role },
        include: memberInclude,
      });
      return { row: updated, changed: true, previous: existing.role };
    });

    if (changed) {
      const project = await this.projectName(projectId);

      await this.activity.record({
        workspaceId,
        actorId: actor.userId,
        action: ActivityAction.MEMBER_ROLE_CHANGED,
        entity: ActivityEntity.PROJECT,
        entityId: projectId,
        projectId,
        summary: `Made ${row.user.name} ${describeRole(role)} of project "${project}"`,
        metadata: { userId, role, previousRole: previous },
      });

      this.announce(ServerEvent.PROJECT_MEMBER_ROLE_CHANGED, access, toMemberDto(row));
    }

    return toMemberDto(row);
  }

  /**
   * "Leave", or an admin removing someone. Idempotent: leaving a project you
   * are not in is not an error, it is already true.
   */
  async remove(
    access: ProjectAccessContext,
    actor: ActorContext,
    userId: string,
  ): Promise<{ removed: boolean }> {
    const { workspaceId, projectId } = access;
    const self = userId === actor.userId;

    if (!self && !access.canManage) {
      throw AppException.forbidden(
        'INSUFFICIENT_PROJECT_ROLE',
        'Only a project admin can remove someone else from this project.',
      );
    }

    const removed = await this.prisma.$transaction(async (tx) => {
      await this.lockProject(tx, projectId);

      const existing = await tx.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        select: { role: true },
      });
      if (!existing) return null;

      if (existing.role === ProjectMemberRole.ADMIN) {
        await this.assertNotLastAdmin(tx, access);
      }

      await tx.projectMember.delete({ where: { projectId_userId: { projectId, userId } } });

      // A lead who is no longer a member is not leading it. Clearing the
      // appointment keeps the two from disagreeing.
      await tx.project.updateMany({
        where: { id: projectId, leadId: userId },
        data: { leadId: null },
      });

      return existing;
    });

    if (!removed) return { removed: false };

    const [project, name] = await Promise.all([this.projectName(projectId), this.userName(userId)]);

    await this.activity.record({
      workspaceId,
      actorId: actor.userId,
      action: ActivityAction.MEMBER_REMOVED,
      entity: ActivityEntity.PROJECT,
      entityId: projectId,
      projectId,
      summary: self ? `Left project "${project}"` : `Removed ${name} from project "${project}"`,
      metadata: { userId, self },
    });

    this.announce(ServerEvent.PROJECT_MEMBER_REMOVED, access, { userId });

    // Out of a private project means out of its room and off its lists — unless
    // they reach it as a workspace admin anyway, in which case nothing changed
    // for them but the roster.
    if (
      access.visibility === ProjectVisibility.PRIVATE &&
      !(await this.hasOverride(workspaceId, userId))
    ) {
      await this.broadcast.revoke(workspaceId, projectId, [userId]);
    }

    this.logger.log({ projectId, userId, self }, 'Project member removed');
    return { removed: true };
  }

  /**
   * Self-service on a public project. A private one has to be joined by
   * invitation — that is what private means — unless the caller reaches it as
   * a workspace admin, who may put themselves on any roster.
   */
  async join(access: ProjectAccessContext, actor: ActorContext): Promise<ProjectMember> {
    if (access.visibility === ProjectVisibility.PRIVATE && !access.canManage) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'This project is private. Ask one of its admins to add you.',
      );
    }

    return this.add(access, actor, actor.userId, defaultJoinRole(actor.role));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Serialises roster changes per project; see the class comment. */
  private async lockProject(tx: Prisma.TransactionClient, projectId: string): Promise<void> {
    await tx.$executeRaw`SELECT "id" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
  }

  /**
   * A private project always keeps an admin. Public projects are reachable by
   * everyone regardless, so the rule does not apply to them — and a project
   * going private picks its admin up on the way (see `ProjectsService.update`).
   */
  private async assertNotLastAdmin(
    tx: Prisma.TransactionClient,
    access: ProjectAccessContext,
  ): Promise<void> {
    if (access.visibility !== ProjectVisibility.PRIVATE) return;

    const admins = await tx.projectMember.count({
      where: { projectId: access.projectId, role: ProjectMemberRole.ADMIN },
    });

    if (admins <= 1) {
      throw AppException.conflict(
        'LAST_PROJECT_ADMIN',
        'A private project must keep at least one admin. Make someone else an admin first.',
      );
    }
  }

  private async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.members.findMembership(workspaceId, userId);

    if (!membership) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'That person is not a member of this workspace.',
      );
    }
  }

  private async hasOverride(workspaceId: string, userId: string): Promise<boolean> {
    const membership = await this.members.findMembership(workspaceId, userId);
    return membership !== null && hasProjectAdminOverride(membership.role);
  }

  private async projectName(projectId: string): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    return project?.name ?? 'a project';
  }

  private async userName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? 'Someone';
  }

  /** Roster events go to the project room: whoever has it open needs them, nobody else does. */
  private announce(event: string, access: ProjectAccessContext, payload: unknown): void {
    this.realtime.emitToProject(access.projectId, event, {
      workspaceId: access.workspaceId,
      projectId: access.projectId,
      ...(payload as Record<string, unknown>),
    });
  }
}

function toMemberDto(row: MemberRow): ProjectMember {
  return {
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    userId: row.userId,
    role: row.role,
    user: row.user,
    addedAt: row.createdAt.toISOString(),
  };
}

function describeRole(role: ProjectMemberRole): string {
  switch (role) {
    case ProjectMemberRole.ADMIN:
      return 'an admin';
    case ProjectMemberRole.EDITOR:
      return 'an editor';
    default:
      return 'a viewer';
  }
}
