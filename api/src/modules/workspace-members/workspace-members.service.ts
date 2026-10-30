import { OAuthAppPolicy, hasAtLeastRole, type WorkspaceRole } from '@coretask/contracts';
import type { WorkspaceMember as WorkspaceMemberDto } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma, WorkspaceMember } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { UsersService } from '../users/users.service';

const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  isServiceAccount: true,
  jobTitle: true,
  pronouns: true,
  outOfOfficeFrom: true,
  outOfOfficeUntil: true,
  outOfOfficeNote: true,
} as const;

@Injectable()
export class WorkspaceMembersService {
  constructor(private readonly prisma: PrismaService) {}

  /** The row, deactivated or not: what decides whether someone can be added again. */
  findMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
  }

  /** A membership that opens the workspace: what pointing work at someone needs. */
  findActiveMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId }, deactivatedAt: null },
    });
  }

  /**
   * The single place that answers "may this user touch this workspace?".
   *
   * Returns 404-flavoured `WORKSPACE_ACCESS_DENIED` rather than distinguishing
   * "does not exist" from "not yours", so workspace ids cannot be enumerated.
   */
  async requireMembership(workspaceId: string, userId: string): Promise<WorkspaceMember> {
    const membership = await this.findMembership(workspaceId, userId);

    if (!membership) {
      throw AppException.forbidden('WORKSPACE_ACCESS_DENIED');
    }

    // Said plainly rather than as "not a member": they were let in once, and
    // the reason they no longer are is theirs to know.
    if (membership.deactivatedAt) {
      throw AppException.forbidden('WORKSPACE_MEMBERSHIP_DEACTIVATED');
    }

    return membership;
  }

  /**
   * Whether an OAuth app may act in a workspace: any app, unless its admins
   * allow only the apps in its app directory.
   */
  async oauthAppAllowed(workspaceId: string, appId: string): Promise<boolean> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { oauthAppPolicy: true, oauthApps: { where: { appId }, select: { id: true } } },
    });
    return (
      !workspace ||
      workspace.oauthAppPolicy === OAuthAppPolicy.ANY ||
      workspace.oauthApps.length > 0
    );
  }

  async requireRole(
    workspaceId: string,
    userId: string,
    minimumRole: WorkspaceRole,
  ): Promise<WorkspaceMember> {
    const membership = await this.requireMembership(workspaceId, userId);

    if (!hasAtLeastRole(membership.role, minimumRole)) {
      throw AppException.forbidden('INSUFFICIENT_WORKSPACE_ROLE', undefined, {
        required: minimumRole,
        actual: membership.role,
      });
    }

    return membership;
  }

  /**
   * People only: the service account behind an API key is managed from the API
   * keys page. Deactivated members are left out, since nothing may be pointed
   * at them; the admin console lists them.
   */
  async listMembers(workspaceId: string): Promise<WorkspaceMemberDto[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, deactivatedAt: null, user: { isServiceAccount: false } },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      include: { user: { select: MEMBER_USER_SELECT } },
    });

    return members.map((member) => ({
      id: member.id,
      workspaceId: member.workspaceId,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
      user: {
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        avatarUrl: member.user.avatarUrl,
        jobTitle: member.user.jobTitle,
        pronouns: member.user.pronouns,
        outOfOffice: UsersService.outOfOfficeOf(member.user),
      },
    }));
  }

  addMember(
    input: { workspaceId: string; userId: string; role: WorkspaceRole; invitedById?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<WorkspaceMember> {
    const client = tx ?? this.prisma;

    return client.workspaceMember.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
        invitedById: input.invitedById ?? null,
      },
    });
  }
}
