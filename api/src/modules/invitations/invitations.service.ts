import { createHash, randomBytes } from 'node:crypto';

import {
  ActivityAction,
  ActivityEntity,
  INVITATION_EXPIRY_DAYS,
  INVITATION_TOKEN_BYTES,
  MAX_PENDING_INVITATIONS,
  NotificationType,
  ProjectMemberRole,
  WorkspaceRole,
  canGrantRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type {
  AcceptInvitationResult,
  AdminInvitationLink,
  WorkspaceInvitation,
  WorkspaceInvitationPreview,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, WorkspaceInvitation as PrismaInvitation } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { EmailQueue } from '../../jobs/email/email.queue';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

import type { CreateInvitationDto } from './dto/invitation.dto';

const invitationInclude = {
  invitedBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
  team: { select: { id: true, name: true, color: true } },
  project: { select: { id: true, name: true } },
} satisfies Prisma.WorkspaceInvitationInclude;

/** Where an invitation from a project's Share dialog lands the person. */
interface ProjectPlacement {
  projectId: string;
  projectRole: ProjectMemberRole;
}

type InvitationWithInviter = Prisma.WorkspaceInvitationGetPayload<{
  include: typeof invitationInclude;
}>;

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogsService,
    private readonly notifications: NotificationDispatcher,
    private readonly emails: EmailQueue,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Creates or refreshes an invitation, and returns it without the token.
   *
   * Re-inviting the same address is the same operation as resending: the row is
   * reused with a fresh token and expiry. That means there is only ever one live
   * offer per address, so revoking cannot leave an older link working.
   */
  async invite(
    workspaceId: string,
    actorId: string,
    actorRole: WorkspaceRole,
    dto: CreateInvitationDto,
    placement: ProjectPlacement | null = null,
  ): Promise<WorkspaceInvitation> {
    const email = dto.email.trim().toLowerCase();

    if (!canGrantRole(actorRole, dto.role)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        dto.role === WorkspaceRole.OWNER
          ? 'Ownership is transferred, not granted by invitation.'
          : 'You cannot invite someone at a role above your own.',
      );
    }

    await this.assertNotAlreadyAMember(workspaceId, email);
    await this.assertCapacity(workspaceId);
    await this.assertTeamInWorkspace(workspaceId, dto.teamId);

    const token = randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 86_400_000);

    const invitation = await this.prisma.workspaceInvitation.upsert({
      where: { workspaceId_email: { workspaceId, email } },
      create: {
        workspaceId,
        email,
        role: dto.role,
        tokenHash: hashToken(token),
        invitedById: actorId,
        teamId: dto.teamId ?? null,
        projectId: placement?.projectId ?? null,
        projectRole: placement?.projectRole ?? null,
        expiresAt,
      },
      update: {
        role: dto.role,
        tokenHash: hashToken(token),
        invitedById: actorId,
        // Re-inviting replaces the team outright, including clearing it: the
        // new offer is the whole intent, not a patch on the previous one.
        teamId: dto.teamId ?? null,
        projectId: placement?.projectId ?? null,
        projectRole: placement?.projectRole ?? null,
        expiresAt,
        // Reinstates an offer that was revoked or already taken up, which is
        // what makes re-inviting a removed member work.
        acceptedAt: null,
        revokedAt: null,
      },
      include: invitationInclude,
    });

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { name: true },
    });

    await this.emails.enqueueInvitation({
      email,
      token,
      workspaceName: workspace.name,
      invitedByName: invitation.invitedBy?.name ?? 'A teammate',
      role: dto.role,
      teamName: invitation.team?.name ?? null,
      projectName: invitation.project?.name ?? null,
      expiresAt: expiresAt.toISOString(),
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.MEMBER_ADDED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: invitation.id,
      summary: `Invited ${email} as ${dto.role.toLowerCase()}`,
      metadata: { email, role: dto.role },
    });

    this.logger.log({ workspaceId, email, role: dto.role }, 'Invitation sent');

    return toInvitationDto(invitation);
  }

  /**
   * Asana's "invite by e-mail" in a project's Share dialog: someone outside
   * the workspace, invited straight into one project.
   *
   * Only a workspace admin may do it, as on the Members page. A project admin
   * who is not one could otherwise bring anyone into the workspace, and a
   * workspace guest still reads every public project.
   *
   * They join the workspace as a member, or as a guest when the project role is
   * VIEWER, which is all a viewer acts as anyway. An address that already holds
   * a live invitation keeps that invitation's team and any higher role: adding
   * a project must not quietly demote an admin-to-be.
   */
  async inviteToProject(
    workspaceId: string,
    projectId: string,
    actorId: string,
    input: { email: string; role: ProjectMemberRole },
  ): Promise<WorkspaceInvitation> {
    const email = input.email.trim().toLowerCase();

    const actor = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId: actorId } },
      select: { role: true },
    });
    if (!actor || !hasAtLeastRole(actor.role, WorkspaceRole.ADMIN)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only a workspace admin can invite someone new. Ask one, or add someone already in the workspace.',
      );
    }

    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email } },
      select: { id: true },
    });
    if (member) {
      throw AppException.conflict(
        'RESOURCE_CONFLICT',
        'That person is already in the workspace. Add them from the list instead.',
      );
    }

    let role: WorkspaceRole =
      input.role === ProjectMemberRole.VIEWER ? WorkspaceRole.GUEST : WorkspaceRole.MEMBER;
    let teamId: string | null = null;

    const live = await this.prisma.workspaceInvitation.findFirst({
      where: {
        workspaceId,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { role: true, teamId: true },
    });
    if (live) {
      if (hasAtLeastRole(live.role, role)) role = live.role;
      teamId = live.teamId;
    }

    return this.invite(
      workspaceId,
      actorId,
      actor.role,
      { email, role, teamId },
      { projectId, projectRole: input.role },
    );
  }

  /** The invitations still waiting that would land someone in this project. */
  async listForProject(workspaceId: string, projectId: string): Promise<WorkspaceInvitation[]> {
    const invitations = await this.prisma.workspaceInvitation.findMany({
      where: { workspaceId, projectId, acceptedAt: null, revokedAt: null },
      include: invitationInclude,
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map(toInvitationDto);
  }

  async list(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const invitations = await this.prisma.workspaceInvitation.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null },
      include: invitationInclude,
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map(toInvitationDto);
  }

  /**
   * A fresh link to a pending invitation, for a super admin to pass on by hand
   * when the e-mail does not reach them. Only a token's hash is ever kept, so
   * there is no old link to read back: this issues a new one, which ends the
   * previous link, and gives the offer a full lifetime again. Accepting still
   * needs an account at the invited address, so a link that travels further
   * than meant opens nothing.
   */
  async issueLink(
    workspaceId: string,
    actorId: string,
    invitationId: string,
  ): Promise<AdminInvitationLink> {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId, acceptedAt: null, revokedAt: null },
      select: { id: true, email: true },
    });
    if (!invitation) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Invitation not found.');
    }

    const token = randomBytes(INVITATION_TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRY_DAYS * 86_400_000);
    await this.prisma.workspaceInvitation.update({
      where: { id: invitationId },
      data: { tokenHash: hashToken(token), expiresAt },
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: invitationId,
      summary: `Made a new invitation link for ${invitation.email}`,
      metadata: { email: invitation.email },
    });

    return {
      url: `${this.config.webOrigin}/invitations/${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async revoke(workspaceId: string, actorId: string, invitationId: string): Promise<void> {
    const invitation = await this.prisma.workspaceInvitation.findFirst({
      where: { id: invitationId, workspaceId, acceptedAt: null, revokedAt: null },
    });

    if (!invitation) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Invitation not found.');
    }

    await this.prisma.workspaceInvitation.update({
      where: { id: invitationId },
      // The hash is cleared to a dead value as well as marking the row revoked:
      // the link stops working even if the `revokedAt` check is ever bypassed.
      data: { revokedAt: new Date(), tokenHash: `revoked:${invitationId}` },
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.MEMBER_REMOVED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: invitationId,
      summary: `Revoked the invitation to ${invitation.email}`,
      metadata: { email: invitation.email },
    });
  }

  /**
   * What the accept page may show before anyone signs in.
   *
   * Anonymous by necessity — the recipient usually has no account yet — so it
   * returns only enough to decide whether to accept, and nothing about the
   * workspace's contents or its other members.
   */
  async preview(token: string): Promise<WorkspaceInvitationPreview> {
    const invitation = await this.requireUsableInvitation(token);

    const workspace = await this.prisma.workspace.findUniqueOrThrow({
      where: { id: invitation.workspaceId },
      select: { name: true },
    });

    const invitedBy = invitation.invitedById
      ? await this.prisma.user.findUnique({
          where: { id: invitation.invitedById },
          select: { name: true },
        })
      : null;

    // Name only. The role is already exposed here for the same reason — it is
    // material to deciding whether to accept — but a roster or a member count
    // would tell the holder of a link things about the workspace's people that
    // they have no business knowing until they are in it.
    const team = invitation.teamId
      ? await this.prisma.team.findUnique({
          where: { id: invitation.teamId },
          select: { name: true },
        })
      : null;
    const project = invitation.projectId
      ? await this.prisma.project.findUnique({
          where: { id: invitation.projectId },
          select: { name: true },
        })
      : null;

    return {
      workspaceName: workspace.name,
      email: invitation.email,
      role: invitation.role,
      invitedByName: invitedBy?.name ?? null,
      teamName: team?.name ?? null,
      projectName: project?.name ?? null,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  /**
   * Joins the signed-in user to the workspace.
   *
   * The account's e-mail must match the address the invitation was sent to.
   * Without that, a forwarded link is a workspace handed to whoever opened it —
   * and the invitation stops being a statement about *who* was invited.
   */
  async accept(token: string, userId: string): Promise<AcceptInvitationResult> {
    const invitation = await this.requireUsableInvitation(token);

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true },
    });

    if (user.email.toLowerCase() !== invitation.email) {
      throw AppException.forbidden(
        'FORBIDDEN',
        `This invitation was sent to ${invitation.email}. Sign in with that address to accept it.`,
      );
    }

    const existing = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: invitation.workspaceId, userId } },
      select: { id: true },
    });

    const workspace = await this.prisma.$transaction(async (tx) => {
      // The link was mailed to this address, and the address is the account's:
      // following it proves the address as well as a confirmation link would.
      await tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date(), emailVerificationDueAt: null },
      });

      if (!existing) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: invitation.workspaceId,
            userId,
            role: invitation.role,
            invitedById: invitation.invitedById,
          },
        });
      }

      /*
       * The team joins in the same transaction as the workspace membership.
       * Doing it afterwards would leave a window where someone is in the
       * workspace but not the team they were invited to, and a failure there
       * would strand them with no way to reach it — the invitation is already
       * spent by then.
       *
       * `teamId` is re-checked against the workspace rather than trusted from
       * when the invitation was written: a team can be deleted between sending
       * and accepting, and `SetNull` handles that, but re-reading costs nothing
       * and keeps the guarantee local to where it matters.
       */
      if (invitation.teamId) {
        const team = await tx.team.findFirst({
          where: { id: invitation.teamId, workspaceId: invitation.workspaceId },
          select: { id: true },
        });

        if (team) {
          await tx.teamMember.upsert({
            where: { teamId_userId: { teamId: team.id, userId } },
            create: { teamId: team.id, userId },
            update: {},
          });
        }
      }

      /*
       * The project, from a Share dialog, joins in the same transaction for
       * the team's reason. Re-read like the team: it may have been deleted or
       * moved since. Someone already on the roster keeps their role, as when
       * a project admin adds them.
       */
      let joinedProjectId: string | null = null;
      if (invitation.projectId && invitation.projectRole) {
        const project = await tx.project.findFirst({
          where: { id: invitation.projectId, workspaceId: invitation.workspaceId },
          select: { id: true },
        });

        if (project) {
          await tx.projectMember.upsert({
            where: { projectId_userId: { projectId: project.id, userId } },
            create: {
              projectId: project.id,
              workspaceId: invitation.workspaceId,
              userId,
              role: invitation.projectRole,
              addedById: invitation.invitedById,
            },
            update: {},
          });
          joinedProjectId = project.id;
        }
      }

      // Marked used inside the same transaction as the membership, so a crash
      // cannot leave a consumed token that granted nothing — or a membership
      // whose invitation is still live.
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      // The link went to this address and the accounts match, so the address
      // is proven: no separate confirmation e-mail needed.
      await tx.user.updateMany({
        where: { id: userId, emailVerifiedAt: null },
        data: { emailVerifiedAt: new Date() },
      });

      const joined = await tx.workspace.findUniqueOrThrow({
        where: { id: invitation.workspaceId },
        select: { id: true, slug: true, name: true },
      });
      return { ...joined, projectId: joinedProjectId };
    });

    await this.activity.record({
      workspaceId: invitation.workspaceId,
      actorId: userId,
      action: ActivityAction.MEMBER_ADDED,
      entity: ActivityEntity.WORKSPACE_MEMBER,
      entityId: userId,
      summary: `${invitation.email} joined as ${invitation.role.toLowerCase()}`,
      metadata: { role: invitation.role },
    });

    if (invitation.invitedById && invitation.invitedById !== userId) {
      await this.notifications.dispatch({
        userId: invitation.invitedById,
        workspaceId: invitation.workspaceId,
        type: NotificationType.WORKSPACE_INVITE,
        title: `${invitation.email} accepted your invitation`,
        body: `They joined ${workspace.name} as a ${invitation.role.toLowerCase()}.`,
        entity: ActivityEntity.WORKSPACE_MEMBER,
        entityId: userId,
        actionUrl: '/members',
      });
    }

    this.logger.log(
      { workspaceId: invitation.workspaceId, userId, role: invitation.role },
      'Invitation accepted',
    );

    return {
      workspaceId: workspace.id,
      workspaceSlug: workspace.slug,
      role: invitation.role,
      projectId: workspace.projectId,
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Resolves a token to an invitation that can still be used.
   *
   * Every rejection is the same 404, whether the token is unknown, revoked,
   * spent or expired. Distinguishing them would let someone probe for which
   * links once existed.
   */
  private async requireUsableInvitation(token: string): Promise<PrismaInvitation> {
    const invitation = await this.prisma.workspaceInvitation.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    const usable =
      invitation !== null &&
      invitation.revokedAt === null &&
      invitation.acceptedAt === null &&
      invitation.expiresAt.getTime() > Date.now();

    if (!usable) {
      throw AppException.notFound(
        'RESOURCE_NOT_FOUND',
        'This invitation is no longer valid. Ask for a new one.',
      );
    }

    return invitation;
  }

  private async assertNotAlreadyAMember(workspaceId: string, email: string): Promise<void> {
    const member = await this.prisma.workspaceMember.findFirst({
      where: { workspaceId, user: { email } },
      select: { id: true },
    });

    if (member) {
      throw AppException.conflict('RESOURCE_CONFLICT', 'That person is already a member.');
    }
  }

  /**
   * The team must belong to this workspace.
   *
   * `teamId` arrives from the client, and the foreign key alone would accept a
   * valid team id from another workspace — which would put the new member on a
   * team their workspace cannot see, and leak its name through the preview.
   */
  private async assertTeamInWorkspace(
    workspaceId: string,
    teamId: string | null | undefined,
  ): Promise<void> {
    if (!teamId) return;

    const team = await this.prisma.team.findFirst({
      where: { id: teamId, workspaceId },
      select: { id: true },
    });

    if (!team) {
      throw AppException.badRequest('BAD_REQUEST', 'That team does not belong to this workspace.');
    }
  }

  private async assertCapacity(workspaceId: string): Promise<void> {
    const pending = await this.prisma.workspaceInvitation.count({
      where: { workspaceId, acceptedAt: null, revokedAt: null },
    });

    if (pending >= MAX_PENDING_INVITATIONS) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'This workspace has too many invitations outstanding. Revoke some first.',
      );
    }
  }
}

/**
 * SHA-256 rather than a slow KDF: the token already carries 256 bits of
 * entropy, so the hash exists to make a database leak unusable, not to resist
 * guessing. Same reasoning as refresh tokens.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toInvitationDto(invitation: InvitationWithInviter): WorkspaceInvitation {
  return {
    id: invitation.id,
    workspaceId: invitation.workspaceId,
    email: invitation.email,
    role: invitation.role,
    invitedBy: invitation.invitedBy,
    team: invitation.team,
    project:
      invitation.project && invitation.projectRole
        ? { ...invitation.project, role: invitation.projectRole }
        : null,
    expiresAt: invitation.expiresAt.toISOString(),
    expired: invitation.expiresAt.getTime() <= Date.now(),
    createdAt: invitation.createdAt.toISOString(),
  };
}
