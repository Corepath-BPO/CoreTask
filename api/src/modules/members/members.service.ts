import {
  ActivityAction,
  ActivityEntity,
  NotificationType,
  ProjectVisibility,
  WorkspaceRole,
  canGrantRole,
  canManageMember,
  hasProjectAdminOverride,
} from '@coretask/contracts';
import type { RemoveMemberResult, WorkspaceMember as WorkspaceMemberDto } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { WorkspaceMember } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ProjectBroadcastService } from '../../websocket/project-broadcast.service';
import { RealtimeGateway } from '../../websocket/realtime.gateway';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { WorkspaceMembersService } from '../workspace-members/workspace-members.service';

import { handOverOpenWork, type HandOverCounts } from './hand-over';

const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  isServiceAccount: true,
} as const;

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
    private readonly realtime: RealtimeGateway,
    private readonly broadcast: ProjectBroadcastService,
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

      await this.closeProjectsLostTo(workspaceId, target.userId, target.role, role);

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
   * Shuts the private projects a demotion just closed.
   *
   * A workspace admin sees every project without a membership row. Drop them
   * below admin and those projects become invisible — but a socket checks its
   * room when it joins and never again, so their open tabs would keep
   * receiving work items, attachments and roster changes from projects they
   * can no longer open. `remove` has the same problem and solves it the same
   * way; this is the demotion half of it.
   *
   * Only the projects they held by rank alone: where they are on the roster,
   * the membership still stands and the per-request role check handles the
   * rest.
   */
  private async closeProjectsLostTo(
    workspaceId: string,
    userId: string,
    from: WorkspaceRole,
    to: WorkspaceRole,
  ): Promise<void> {
    if (!hasProjectAdminOverride(from) || hasProjectAdminOverride(to)) return;

    const stranded = await this.prisma.project.findMany({
      where: {
        workspaceId,
        visibility: ProjectVisibility.PRIVATE,
        members: { none: { userId } },
      },
      select: { id: true },
    });

    await Promise.all(
      stranded.map((project) => this.broadcast.revoke(workspaceId, project.id, [userId])),
    );
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
    options: { reassignToUserId?: string | null } = {},
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

    const recipient =
      options.reassignToUserId && !leaving
        ? await this.requireRecipient(workspaceId, options.reassignToUserId, target)
        : null;

    const result = await this.endMembership(target, actorId, leaving, recipient);
    await this.tellRecipient(workspaceId, recipient, result);
    return result;
  }

  /**
   * Cuts a member's access off without ending the membership, as Asana's
   * admin console deactivates someone.
   *
   * The row stays, with its role, teams and project places, so reactivating
   * gives back exactly what was there; and an Asana sync or an SSO sign-in
   * that would add them again finds the row and leaves it be. Their open work
   * goes to `reassignToUserId` where that member may be assigned it, and is
   * unassigned otherwise: nothing should wait on someone who cannot get in.
   */
  async deactivate(
    workspaceId: string,
    actorId: string,
    memberId: string,
    options: { reassignToUserId?: string | null } = {},
  ): Promise<HandOverCounts> {
    const actor = await this.members.requireRole(workspaceId, actorId, WorkspaceRole.SUPER_ADMIN);
    const target = await this.requireMember(workspaceId, memberId);

    if (target.role === WorkspaceRole.OWNER) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'The owner cannot be deactivated. Transfer ownership first.',
      );
    }
    this.assertOutranks(actor.role, target.role, target.userId === actorId);
    if (target.deactivatedAt) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This member is already deactivated.');
    }

    const recipient = options.reassignToUserId
      ? await this.requireRecipient(workspaceId, options.reassignToUserId, target)
      : null;

    const counts = await this.prisma.$transaction(async (tx) => {
      const handedOver = await handOverOpenWork(tx, {
        workspaceId,
        fromUserId: target.userId,
        to: recipient,
      });
      await tx.workspaceMember.update({
        where: { id: memberId },
        data: { deactivatedAt: new Date(), deactivatedById: actorId },
      });
      return handedOver;
    });

    // After the write, as with removal: their open tabs stop receiving the
    // workspace now, not at their next request. Their project rooms too, since
    // the project places they keep for reactivation still name them.
    await this.realtime.evictFromWorkspace(workspaceId, target.userId);
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      select: { id: true },
    });
    await Promise.all(
      projects.map((project) => this.realtime.evictFromProject(project.id, target.userId)),
    );

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.MEMBER_DEACTIVATED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: target.userId,
      summary: 'Deactivated a member',
      metadata: { role: target.role, reassignedTo: recipient?.userId ?? null, ...counts },
    });
    await this.tellRecipient(workspaceId, recipient, counts);

    this.logger.log({ workspaceId, memberId, ...counts }, 'Member deactivated');
    return counts;
  }

  /** Gives a deactivated member their access back, with the role they held. */
  async reactivate(workspaceId: string, actorId: string, memberId: string): Promise<void> {
    const actor = await this.members.requireRole(workspaceId, actorId, WorkspaceRole.SUPER_ADMIN);
    const target = await this.requireMember(workspaceId, memberId);

    this.assertOutranks(actor.role, target.role, target.userId === actorId);
    if (!target.deactivatedAt) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This member is not deactivated.');
    }

    await this.prisma.workspaceMember.update({
      where: { id: memberId },
      data: { deactivatedAt: null, deactivatedById: null },
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.MEMBER_REACTIVATED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: target.userId,
      summary: 'Reactivated a member',
      metadata: { role: target.role },
    });

    await this.notifications.dispatch({
      userId: target.userId,
      workspaceId,
      type: NotificationType.WORKSPACE_INVITE,
      title: 'Your access is back',
      body: 'A super admin reactivated your membership of this workspace.',
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: target.userId,
      actionUrl: '/',
    });
  }

  /**
   * Leaves a workspace on the way out of CoreTask, exactly as "leave" would:
   * deleting an account ends each membership it does not own this way, so
   * open work is unassigned and rosters forget them. The owner's own
   * workspaces are deleted or block the deletion before it gets here.
   */
  async leaveForAccountDeletion(workspaceId: string, userId: string): Promise<RemoveMemberResult> {
    const membership = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership)
      return {
        removed: true,
        tasksReassigned: 0,
        ticketsReassigned: 0,
        tasksUnassigned: 0,
        ticketsUnassigned: 0,
        teamsLeft: 0,
      };
    if (membership.role === WorkspaceRole.OWNER) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Transfer ownership before leaving the workspace.',
      );
    }
    return this.endMembership(membership, userId, true, null);
  }

  /** Ends one membership, after whatever check the caller needed. */
  private async endMembership(
    target: WorkspaceMember,
    actorId: string,
    leaving: boolean,
    recipient: { userId: string; role: WorkspaceRole } | null,
  ): Promise<RemoveMemberResult> {
    const { workspaceId, id: memberId } = target;

    /*
     * Assignment points at a *user*, not a membership, so nothing in the schema
     * clears it — the board would keep showing work assigned to someone who can
     * no longer open it. Handing it over shares the transaction with the
     * removal so the two can never disagree.
     */
    const result = await this.prisma.$transaction(async (tx) => {
      const handedOver = await handOverOpenWork(tx, {
        workspaceId,
        fromUserId: target.userId,
        to: recipient,
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

      // Project membership has the same shape again: rows are dropped here
      // rather than left to keep a private project open to someone who is
      // gone. A private project whose last admin leaves this way is still
      // reachable by the workspace's admins, so nothing is stranded.
      await tx.projectMember.deleteMany({ where: { workspaceId, userId: target.userId } });
      await tx.project.updateMany({
        where: { workspaceId, leadId: target.userId },
        data: { leadId: null },
      });

      // Nor following anything: a follower row would keep sending them the
      // thread of a task they can no longer open.
      await tx.follower.deleteMany({ where: { workspaceId, userId: target.userId } });

      await tx.workspaceMember.delete({ where: { id: memberId } });

      // Remembered, so their identity provider cannot quietly sign them back
      // in by address: only an invitation brings them back now.
      await tx.workspaceDeparture.upsert({
        where: { workspaceId_userId: { workspaceId, userId: target.userId } },
        create: { workspaceId, userId: target.userId },
        update: { departedAt: new Date() },
      });

      return { ...handedOver, teamsLeft: teams.count };
    });

    /*
     * And cut off their live connection.
     *
     * Membership is checked when a socket joins a room and never again, so
     * without this their open tabs kept receiving every task, section, ticket
     * and comment in a workspace they are no longer in — full payloads, not
     * ids. Deleting the row stops the next request and does nothing about the
     * stream already flowing.
     *
     * After the transaction, deliberately. Evicting first would leave a window
     * where the write could still roll back and the person would be cut off
     * from a workspace they are in fact still a member of.
     */
    await this.realtime.evictFromWorkspace(workspaceId, target.userId);

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
   * The outgoing owner becomes a super admin rather than losing access:
   * dropping them to nothing would lock them out of something they built, and
   * there is no undo. A super admin still runs the admin console, so handing
   * the workspace on does not also hand away its administration. Both writes share a transaction, so there is never an instant with two
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
        data: { role: WorkspaceRole.SUPER_ADMIN },
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

  /** Who may take over someone's open work: another member who can get in. */
  private async requireRecipient(
    workspaceId: string,
    userId: string,
    from: WorkspaceMember,
  ): Promise<{ userId: string; role: WorkspaceRole }> {
    if (userId === from.userId) {
      throw AppException.badRequest('BAD_REQUEST', 'Choose someone else to take over their work.');
    }
    const recipient = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId }, deactivatedAt: null },
      select: { userId: true, role: true, user: { select: { isServiceAccount: true } } },
    });
    if (!recipient || recipient.user.isServiceAccount) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Their work can only go to an active member of this workspace.',
      );
    }
    return { userId: recipient.userId, role: recipient.role };
  }

  /** One notification for the whole hand-over, rather than one per task. */
  private async tellRecipient(
    workspaceId: string,
    recipient: { userId: string } | null,
    counts: HandOverCounts,
  ): Promise<void> {
    if (!recipient || counts.tasksReassigned + counts.ticketsReassigned === 0) return;

    const parts = [
      counts.tasksReassigned > 0 ? plural(counts.tasksReassigned, 'task') : null,
      counts.ticketsReassigned > 0 ? plural(counts.ticketsReassigned, 'ticket') : null,
    ].filter(Boolean);
    await this.notifications.dispatch({
      userId: recipient.userId,
      workspaceId,
      type: NotificationType.TASK_ASSIGNED,
      title: `${parts.join(' and ')} handed over to you`,
      body: 'A super admin reassigned open work from someone who no longer has access.',
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: recipient.userId,
      actionUrl: '/my-tasks',
    });
  }

  private async requireMember(workspaceId: string, memberId: string): Promise<WorkspaceMember> {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { id: memberId, workspaceId },
      include: { user: { select: { isServiceAccount: true } } },
    });

    if (!member) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Member not found.');
    }

    // The membership behind an API key is managed with the key. Changing its
    // role, removing it or handing it ownership from here would leave the two
    // disagreeing about what the key may do.
    if (member.user.isServiceAccount) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Manage integration access from the API keys page.',
      );
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

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
