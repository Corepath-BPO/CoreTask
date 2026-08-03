import { hasAtLeastRole, type WorkspaceRole } from '@coretask/contracts';
import type { WorkspaceMember as WorkspaceMemberDto } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma, WorkspaceMember } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';

const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

@Injectable()
export class WorkspaceMembersService {
  constructor(private readonly prisma: PrismaService) {}

  findMembership(workspaceId: string, userId: string): Promise<WorkspaceMember | null> {
    return this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
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

    return membership;
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

  async listMembers(workspaceId: string): Promise<WorkspaceMemberDto[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
      include: { user: { select: MEMBER_USER_SELECT } },
    });

    return members.map((member) => ({
      id: member.id,
      workspaceId: member.workspaceId,
      role: member.role,
      joinedAt: member.joinedAt.toISOString(),
      user: member.user,
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
