import { ActivityAction, ServerEvent, WorkspaceRole, hasAtLeastRole } from '@coretask/contracts';
import type { Follower } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectBroadcastService } from '../../websocket/project-broadcast.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import type { ItemLink, ItemRef } from './item-ref';

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
  isServiceAccount: true,
} as const;

/**
 * Collaborators on a task or ticket.
 *
 * Two ways in. `ensure` is the silent one every write path calls — creating,
 * assigning, commenting, mentioning — and it writes no story, because Asana
 * does not announce that the assignee now follows the task. `add` and `remove`
 * are the deliberate ones behind the panel's "+" and "Leave task", and those
 * do read as stories.
 *
 * Only current members ever follow, and only people who can see the item's
 * project. A row for anyone else would make notifications go to a person who
 * cannot open the item, so both are checked on the way in and filtered again
 * on the way out.
 */
@Injectable()
export class FollowersService {
  private readonly logger = new Logger(FollowersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityLogsService,
    private readonly access: ProjectAccessService,
    private readonly broadcast: ProjectBroadcastService,
  ) {}

  /**
   * Adds whoever is not following yet, quietly. Returns the ids actually added,
   * so a caller can tell a first-time follower from someone already there.
   */
  async ensure(
    workspaceId: string,
    link: ItemLink,
    userIds: readonly (string | null | undefined)[],
  ): Promise<string[]> {
    const wanted = [
      ...new Set(userIds.filter((id): id is string => typeof id === 'string' && id.length > 0)),
    ];
    if (wanted.length === 0) return [];

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId, userId: { in: wanted } },
      select: { userId: true },
    });
    const projectId = await this.projectIdOf(link);
    const memberIds = await this.access.filterVisibleTo(
      workspaceId,
      projectId,
      members.map((member) => member.userId),
    );
    if (memberIds.length === 0) return [];

    const existing = await this.prisma.follower.findMany({
      where: { ...link, userId: { in: memberIds } },
      select: { userId: true },
    });
    const already = new Set(existing.map((row) => row.userId));
    const added = memberIds.filter((id) => !already.has(id));
    if (added.length === 0) return [];

    // `skipDuplicates` covers the race where two writes add the same person at
    // once: the unique index refuses the second and nothing fails.
    await this.prisma.follower.createMany({
      data: added.map((userId) => ({ workspaceId, userId, ...link })),
      skipDuplicates: true,
    });

    this.announce(workspaceId, link, projectId);
    return added;
  }

  /** The panel's "+": somebody chose these people. */
  async add(ref: ItemRef, actorId: string, userIds: readonly string[]): Promise<Follower[]> {
    const wanted = [...new Set(userIds)];

    const members = await this.prisma.workspaceMember.findMany({
      where: { workspaceId: ref.workspaceId, userId: { in: wanted } },
      select: { userId: true, user: { select: { name: true } } },
    });
    if (members.length !== wanted.length) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Everyone added as a collaborator must be a member of this workspace.',
      );
    }
    await this.access.assertUsersCanSee(
      ref.workspaceId,
      ref.projectId,
      wanted,
      'Everyone added as a collaborator must be able to see this project.',
    );

    const added = await this.ensure(ref.workspaceId, ref.link, wanted);
    if (added.length > 0) {
      const users = members
        .filter((member) => added.includes(member.userId))
        .map((member) => ({ id: member.userId, label: member.user.name }));
      const self = added.length === 1 && added[0] === actorId;

      await this.activity.record({
        workspaceId: ref.workspaceId,
        actorId,
        action: ActivityAction.FOLLOWED,
        entity: ref.entity,
        entityId: ref.entityId,
        projectId: ref.projectId,
        summary: self
          ? `Joined ${ref.label}`
          : `Added ${users.map((user) => user.label).join(', ')} to ${ref.label}`,
        metadata: { users, self },
      });
    }

    return this.list(ref.workspaceId, ref.link);
  }

  /**
   * "Leave task", or a manager removing someone. Idempotent: leaving something
   * you do not follow is not an error, it is already true. "Manager" is judged
   * inside the item's project, so a viewer there cannot eject anyone.
   */
  async remove(ref: ItemRef, actor: ActorContext, userId: string): Promise<Follower[]> {
    const self = userId === actor.userId;
    if (!self) {
      const effective = await this.access.effectiveRoleFor(ref.projectId, actor);
      if (!hasAtLeastRole(effective, WorkspaceRole.MANAGER)) {
        throw AppException.forbidden(
          'FORBIDDEN',
          'Only a workspace manager can remove another collaborator.',
        );
      }
    }

    const result = await this.prisma.follower.deleteMany({ where: { ...ref.link, userId } });

    if (result.count > 0) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      });
      const label = user?.name ?? 'Someone';

      await this.activity.record({
        workspaceId: ref.workspaceId,
        actorId: actor.userId,
        action: ActivityAction.UNFOLLOWED,
        entity: ref.entity,
        entityId: ref.entityId,
        projectId: ref.projectId,
        summary: self ? `Left ${ref.label}` : `Removed ${label} from ${ref.label}`,
        metadata: { users: [{ id: userId, label }], self },
      });

      this.announce(ref.workspaceId, ref.link, ref.projectId);
    }

    return this.list(ref.workspaceId, ref.link);
  }

  async list(workspaceId: string, link: ItemLink): Promise<Follower[]> {
    const rows = await this.prisma.follower.findMany({
      where: { ...link, workspaceId, user: { memberships: { some: { workspaceId } } } },
      include: { user: { select: USER_SELECT } },
      // Creation order, so the creator reads first and the avatars stay put.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return rows.map((row) => ({ user: row.user, followedAt: row.createdAt.toISOString() }));
  }

  /**
   * Who to notify. Current members who can still see the project, for the
   * same reason `list` filters: a follower row outlives a removal from a
   * private project, and a notification they cannot open is worse than none.
   */
  async followerIds(workspaceId: string, link: ItemLink): Promise<string[]> {
    const rows = await this.prisma.follower.findMany({
      where: { ...link, workspaceId, user: { memberships: { some: { workspaceId } } } },
      select: { userId: true },
    });

    return this.access.filterVisibleTo(
      workspaceId,
      await this.projectIdOf(link),
      rows.map((row) => row.userId),
    );
  }

  /** The project behind a link, from whichever side of it is set. */
  private async projectIdOf(link: ItemLink): Promise<string | null> {
    if (link.taskId) {
      const task = await this.prisma.task.findUnique({
        where: { id: link.taskId },
        select: { projectId: true },
      });
      return task?.projectId ?? null;
    }
    if (link.ticketId) {
      const ticket = await this.prisma.ticket.findUnique({
        where: { id: link.ticketId },
        select: { projectId: true },
      });
      return ticket?.projectId ?? null;
    }
    return null;
  }

  private announce(workspaceId: string, link: ItemLink, projectId: string | null): void {
    void this.broadcast
      .emit(workspaceId, projectId, ServerEvent.FOLLOWERS_CHANGED, { workspaceId, ...link })
      .catch((error: unknown) => {
        this.logger.warn({ err: error, ...link }, 'Could not announce a follower change');
      });
  }
}
