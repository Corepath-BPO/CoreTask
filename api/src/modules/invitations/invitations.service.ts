import { createHash, randomBytes } from 'node:crypto';

import {
  ActivityAction,
  ActivityEntity,
  INVITATION_EXPIRY_DAYS,
  INVITATION_TOKEN_BYTES,
  MAX_PENDING_INVITATIONS,
  NotificationType,
  WorkspaceRole,
  canGrantRole,
} from '@coretask/contracts';
import type {
  AcceptInvitationResult,
  WorkspaceInvitation,
  WorkspaceInvitationPreview,
} from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, WorkspaceInvitation as PrismaInvitation } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { NotificationDispatcher } from '../../integrations/notifications/notification.dispatcher';
import { EmailQueue } from '../../jobs/email/email.queue';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

import type { CreateInvitationDto } from './dto/invitation.dto';

const invitationInclude = {
  invitedBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
} satisfies Prisma.WorkspaceInvitationInclude;

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
        expiresAt,
      },
      update: {
        role: dto.role,
        tokenHash: hashToken(token),
        invitedById: actorId,
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

  async list(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const invitations = await this.prisma.workspaceInvitation.findMany({
      where: { workspaceId, acceptedAt: null, revokedAt: null },
      include: invitationInclude,
      orderBy: { createdAt: 'desc' },
    });

    return invitations.map(toInvitationDto);
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

    return {
      workspaceName: workspace.name,
      email: invitation.email,
      role: invitation.role,
      invitedByName: invitedBy?.name ?? null,
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

      // Marked used inside the same transaction as the membership, so a crash
      // cannot leave a consumed token that granted nothing — or a membership
      // whose invitation is still live.
      await tx.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { acceptedAt: new Date() },
      });

      return tx.workspace.findUniqueOrThrow({
        where: { id: invitation.workspaceId },
        select: { id: true, slug: true, name: true },
      });
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
    expiresAt: invitation.expiresAt.toISOString(),
    expired: invitation.expiresAt.getTime() <= Date.now(),
    createdAt: invitation.createdAt.toISOString(),
  };
}
