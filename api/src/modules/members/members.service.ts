import {
  ActivityAction,
  ActivityEntity,
  CLOSED_TASK_STATUSES,
  CLOSED_TICKET_STATUSES,
  NotificationType,
  WorkspaceRole,
  canGrantRole,
  canManageMember,
} from '@coretask/contracts';
import type { RemoveMemberResult, WorkspaceMember as WorkspaceMemberDto } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { WorkspaceMember } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { WorkspaceMembersService } from '../workspace-members/workspace-members.service';

const MEMBER_USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

/**
 * Changing and ending memberships.
 *
 * Deliberately separate from `WorkspaceMembersService`, which every guarded
 * route depends on. Folding these operations in there would make the guard's
 * module pull in activity logging and notifications — and since the
 * notifications module is itself guarded, that closes a dependency cycle. A
 * leaf module for the management operations keeps the guard's dependencies as
 * small as the guard actually is.
 */
@Injectable()
export class MembersService {
  private readonly logger = new Logger(MembersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: WorkspaceMembersService,
    private readonly activity: ActivityLogsService,
    private readonly notifications: NotificationDispatcher,
  ) {}

  /**
   * Changes a member's role.
   *
   * Two rules, both needing the caller's rank *and* the target's current rank,
   * which is why they live here rather than in a route decorator:
   *
   * - You must outrank the person you are acting on, so peers cannot demote one
   *   another and nobody can act on themselves.
   * - You cannot hand out a role above your own, and never `OWNER` — that is a
   *   transfer, with its own consequences and its own endpoint.
   */
  async updateRole(
    workspaceId: string,
    actorId: string,
    memberId: string,
    role: WorkspaceRole,
  ): Promise<WorkspaceMemberDto> {
    const actor = await this.members.requireRole(workspaceId, actorId, WorkspaceRole.ADMIN);
    const target = await this.requireMember(workspaceId, memberId);

    this.assertOutranks(actor.role, target.role, target.userId === actorId);

    if (!canGrantRole(actor.role, role)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        role === WorkspaceRole.OWNER
          ? 'Ownership is transferred, not assigned.'
          : 'You cannot grant a role above your own.',
      );
    }

    if (target.role !== role) {
      await this.prisma.workspaceMember.update({ where: { id: memberId }, data: { role } });

      await this.activity.record({
        workspaceId,
        actorId,
        action: ActivityAction.MEMBER_ROLE_CHANGED,
        entity: ActivityEntity.WORKSPACE_MEMBER,
        entityId: target.userId,
        summary: `Changed a member's role from ${target.role.toLowerCase()} to ${role.toLowerCase()}`,
        metadata: { from: target.role, to: role },
      });
    }

    return this.readMember(memberId);
  }

  /**
   * Removes a member, or lets one leave.
   *
   * Removing someone takes work away from them, so it carries the same rank rule
   * as a role change. Leaving needs no rank at all — you are only giving up your
   * own access. The owner can do neither: a workspace with no owner has nobody
   * who can transfer it.
   */
  async remove(
    workspaceId: string,
    actorId: string,
    memberId: string,
  ): Promise<RemoveMemberResult> {
    const target = await this.requireMember(workspaceId, memberId);
    const leaving = target.userId === actorId;

    if (target.role === WorkspaceRole.OWNER) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        leaving
          ? 'Transfer ownership before leaving the workspace.'
          : 'The owner cannot be removed. Transfer ownership first.',
      );
    }

    if (!leaving) {
      const actor = await this.members.requireRole(workspaceId, actorId, WorkspaceRole.ADMIN);
      this.assertOutranks(actor.role, target.role, false);
    }

    /*
     * Assignment points at a *user*, not a membership, so nothing in the schema
     * clears it — the board would keep showing work assigned to someone who can
     * no longer open it. Unassigning shares the transaction with the removal so
     * the two can never disagree.
     *
     * Only open work. A finished task records who did it, and rewriting that
     * would falsify history; the same goes for comments and reported tickets.
     */
    const result = await this.prisma.$transaction(async (tx) => {
      const tasks = await tx.task.updateMany({
        where: {
          workspaceId,
          assigneeId: target.userId,
          status: { notIn: [...CLOSED_TASK_STATUSES] },
        },
        data: { assigneeId: null },
      });

      const tickets = await tx.ticket.updateMany({
        where: {
          workspaceId,
          assigneeId: target.userId,
          status: { notIn: [...CLOSED_TICKET_STATUSES] },
        },
        data: { assigneeId: null },
      });

      /*
       * Team membership has the same shape of problem: `TeamMember.userId`
       * cascades on *user* deletion, and this is not one. Left alone the person
       * would keep appearing on team rosters in a workspace they no longer
       * belong to. Scoped to this workspace's teams — their teams elsewhere are
       * none of this removal's business.
       */
      const teams = await tx.teamMember.deleteMany({
        where: { userId: target.userId, team: { workspaceId } },
      });

      // A lead who is no longer in the workspace is not leading anything.
      await tx.team.updateMany({
        where: { workspaceId, leadId: target.userId },
        data: { leadId: null },
      });

      await tx.workspaceMember.delete({ where: { id: memberId } });

      return {
        tasksUnassigned: tasks.count,
        ticketsUnassigned: tickets.count,
        teamsLeft: teams.count,
      };
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.MEMBER_REMOVED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: target.userId,
      summary: leaving ? 'Left the workspace' : 'Removed a member from the workspace',
      metadata: { role: target.role, ...result },
    });

    this.logger.log({ workspaceId, memberId, leaving, ...result }, 'Membership ended');

    return { removed: true, ...result };
  }

  /**
   * Hands the workspace to another member.
   *
   * The outgoing owner becomes an admin rather than losing access: dropping them
   * to nothing would lock them out of something they built, and there is no
   * undo. Both writes share a transaction, so there is never an instant with two
   * owners or none.
   */
  async transferOwnership(
    workspaceId: string,
    actorId: string,
    memberId: string,
  ): Promise<WorkspaceMemberDto> {
    const actor = await this.members.requireRole(workspaceId, actorId, WorkspaceRole.OWNER);
    const target = await this.requireMember(workspaceId, memberId);

    if (target.userId === actorId) {
      throw AppException.badRequest('BAD_REQUEST', 'You already own this workspace.');
    }

    await this.prisma.$transaction([
      this.prisma.workspaceMember.update({
        where: { id: actor.id },
        data: { role: WorkspaceRole.ADMIN },
      }),
      this.prisma.workspaceMember.update({
        where: { id: memberId },
        data: { role: WorkspaceRole.OWNER },
      }),
    ]);

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.MEMBER_ROLE_CHANGED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: target.userId,
      summary: 'Transferred ownership of the workspace',
      metadata: { previousOwnerId: actorId },
    });

    await this.notifications.dispatch({
      userId: target.userId,
      workspaceId,
      type: NotificationType.WORKSPACE_INVITE,
      title: 'You now own this workspace',
      body: 'Ownership was transferred to you.',
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: target.userId,
      actionUrl: '/members',
    });

    this.logger.warn({ workspaceId, from: actorId, to: target.userId }, 'Ownership transferred');

    return this.readMember(memberId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private assertOutranks(actor: WorkspaceRole, target: WorkspaceRole, isSelf: boolean): void {
    if (canManageMember(actor, target)) return;

    throw AppException.forbidden(
      'FORBIDDEN',
      isSelf
        ? 'You cannot change your own role.'
        : 'You can only manage members below your own role.',
    );
  }

  private async requireMember(workspaceId: string, memberId: string): Promise<WorkspaceMember> {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
    });

    if (!member) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Member not found.');
    }

    return member;
  }

  private async readMember(memberId: string): Promise<WorkspaceMemberDto> {
    const member = await this.prisma.workspaceMember.findUniqueOrThrow({
      where: { id: memberId },
      include: { user: { select: MEMBER_USER_SELECT } },
    });

    return {
      id: member.id,
      workspaceId: member.workspaceId,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
      user: member.user,
    };
  }
}
