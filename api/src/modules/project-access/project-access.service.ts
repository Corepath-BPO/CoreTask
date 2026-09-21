import {
  ProjectVisibility,
  WorkspaceRole,
  canManageProject,
  canSeeProject,
  effectiveWorkspaceRole,
  hasAtLeastRole,
  hasProjectAdminOverride,
  type ProjectMemberRole,
} from '@coretask/contracts';
import { Injectable } from '@nestjs/common';
import type { Prisma, Project } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext, ProjectAccessContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';

export interface ResolvedProjectAccess extends ProjectAccessContext {
  project: Project;
}

/** An actor whose workspace role may not be known yet — the socket gateway's case. */
export interface VisibilityActor {
  userId: string;
  role?: WorkspaceRole;
}

/**
 * Where-fragment for any table that hangs off a project through a nullable
 * `projectId` (tasks, tickets, activity lines): rows with no project are
 * workspace-level and stay visible; the rest follow the project's visibility.
 */
export type ProjectScopedWhere =
  { OR: Array<{ projectId: null } | { project: Prisma.ProjectWhereInput }> } | Record<never, never>;

/** The same idea for rows that hang off a task *or* a ticket (comments, attachments). */
export type ItemParentWhere =
  | {
      OR: Array<
        { task: { is: Prisma.TaskWhereInput } } | { ticket: { is: Prisma.TicketWhereInput } }
      >;
    }
  | Record<never, never>;

const ADMIN_ROLES: WorkspaceRole[] = [WorkspaceRole.OWNER, WorkspaceRole.ADMIN];

/**
 * The single place that answers "may this person see this project, and as what?".
 *
 * Deliberately Prisma-only so every module can import it. The rules themselves
 * live in `@coretask/contracts` (`project-roles.ts`); this service applies them
 * to rows and turns them into query fragments.
 */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's standing in one project, or null when the project does not
   * exist in this workspace or is private and closed to them. One query.
   */
  async findAccess(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ResolvedProjectAccess | null> {
    const row = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      include: { members: { where: { userId: actor.userId }, select: { role: true } } },
    });

    if (!row) return null;

    const { members, ...project } = row;
    const projectRole = members[0]?.role ?? null;

    if (!canSeeProject(project.visibility, actor.role, projectRole !== null)) return null;

    return this.describe(project, actor, projectRole);
  }

  /**
   * Like `findAccess`, but a project the caller cannot see is a 404: an
   * invisible project must look exactly like one that does not exist, or the
   * response itself would reveal that something private is there.
   */
  async resolveAccess(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
  ): Promise<ResolvedProjectAccess> {
    const access = await this.findAccess(workspaceId, projectId, actor);

    if (!access) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found.');
    }

    return access;
  }

  /**
   * `resolveAccess`, then 403 unless the caller acts with at least `minimum`
   * in the project. For a `projectId` that arrives in a request body rather
   * than the URL, where `ProjectAccessGuard` could not run.
   */
  async requireAccess(
    workspaceId: string,
    projectId: string,
    actor: ActorContext,
    minimum?: WorkspaceRole,
  ): Promise<ResolvedProjectAccess> {
    const access = await this.resolveAccess(workspaceId, projectId, actor);

    if (minimum && !hasAtLeastRole(access.effectiveRole, minimum)) {
      throw AppException.forbidden(
        access.effectiveRole === actor.role
          ? 'INSUFFICIENT_WORKSPACE_ROLE'
          : 'INSUFFICIENT_PROJECT_ROLE',
        undefined,
        { required: minimum, actual: access.effectiveRole },
      );
    }

    return access;
  }

  /** Turns a loaded project and a known membership into the access shape. */
  describe(
    project: Project,
    actor: ActorContext,
    projectRole: ProjectMemberRole | null,
  ): ResolvedProjectAccess {
    return {
      project,
      projectId: project.id,
      workspaceId: project.workspaceId,
      visibility: project.visibility,
      projectRole,
      isMember: projectRole !== null,
      effectiveRole: effectiveWorkspaceRole(actor.role, projectRole),
      canManage: canManageProject(actor.role, projectRole),
      override: hasProjectAdminOverride(actor.role),
    };
  }

  /**
   * Where-fragment selecting the projects `actor` may see. Compose it under
   * `AND: [...]` — several list queries already own a top-level `OR`.
   *
   * When the role is not known (sockets), the admin override is expressed as
   * a third branch on the workspace membership instead of short-circuiting.
   */
  projectWhere(actor: VisibilityActor): Prisma.ProjectWhereInput {
    if (actor.role && hasProjectAdminOverride(actor.role)) return {};

    const branches: Prisma.ProjectWhereInput[] = [
      { visibility: ProjectVisibility.PUBLIC },
      { members: { some: { userId: actor.userId } } },
    ];

    if (!actor.role) {
      branches.push({
        workspace: { members: { some: { userId: actor.userId, role: { in: ADMIN_ROLES } } } },
      });
    }

    return { OR: branches };
  }

  /** `projectWhere` for rows that carry a nullable `projectId` (tasks, tickets, activity). */
  scopedWhere(actor: VisibilityActor): ProjectScopedWhere {
    if (actor.role && hasProjectAdminOverride(actor.role)) return {};
    return { OR: [{ projectId: null }, { project: this.projectWhere(actor) }] };
  }

  /** `projectWhere` for rows that hang off a task or a ticket (comments, attachments). */
  itemParentWhere(actor: VisibilityActor): ItemParentWhere {
    if (actor.role && hasProjectAdminOverride(actor.role)) return {};
    const scoped = this.scopedWhere(actor);
    return { OR: [{ task: { is: scoped } }, { ticket: { is: scoped } }] };
  }

  /**
   * The role `actor` acts with on an item in `projectId`. A workspace-level
   * item (no project) is governed by the workspace role alone.
   *
   * Assumes the item was loaded through a scoped where, so visibility is
   * settled; this only applies the cap.
   */
  async effectiveRoleFor(projectId: string | null, actor: ActorContext): Promise<WorkspaceRole> {
    if (!projectId || hasProjectAdminOverride(actor.role)) return actor.role;

    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: actor.userId } },
      select: { role: true },
    });

    return effectiveWorkspaceRole(actor.role, membership?.role ?? null);
  }

  /**
   * 403 unless `actor` acts with at least `minimum` on an item in `projectId`.
   * Names the project as the reason only when the project lowered the role;
   * otherwise it is the plain workspace-role refusal callers already know.
   */
  async assertEffectiveRole(
    projectId: string | null,
    actor: ActorContext,
    minimum: WorkspaceRole,
  ): Promise<WorkspaceRole> {
    const effective = await this.effectiveRoleFor(projectId, actor);

    if (!hasAtLeastRole(effective, minimum)) {
      throw AppException.forbidden(
        effective === actor.role ? 'INSUFFICIENT_WORKSPACE_ROLE' : 'INSUFFICIENT_PROJECT_ROLE',
        undefined,
        { required: minimum, actual: effective },
      );
    }

    return effective;
  }

  /** The visibility of one project, or null when it does not exist. */
  async visibilityOf(projectId: string): Promise<ProjectVisibility | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { visibility: true },
    });
    return project?.visibility ?? null;
  }

  /**
   * Drops the users who cannot see `projectId`. Order is kept. A public or
   * absent project passes everyone through untouched.
   *
   * This is what keeps notifications, collaborator fan-out and mentions from
   * reaching people about work they cannot open.
   */
  async filterVisibleTo(
    workspaceId: string,
    projectId: string | null,
    userIds: readonly string[],
  ): Promise<string[]> {
    if (!projectId || userIds.length === 0) return [...userIds];

    const visibility = await this.visibilityOf(projectId);
    if (visibility !== ProjectVisibility.PRIVATE) return [...userIds];

    const candidates = [...new Set(userIds)];
    const [members, admins] = await Promise.all([
      this.prisma.projectMember.findMany({
        where: { projectId, userId: { in: candidates } },
        select: { userId: true },
      }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId, userId: { in: candidates }, role: { in: ADMIN_ROLES } },
        select: { userId: true },
      }),
    ]);

    const allowed = new Set([...members, ...admins].map((row) => row.userId));
    return userIds.filter((userId) => allowed.has(userId));
  }

  /**
   * 400 unless every one of `userIds` can see `projectId` — the rule for an
   * assignee, a lead or a collaborator: pointing someone at work they cannot
   * open helps nobody.
   */
  async assertUsersCanSee(
    workspaceId: string,
    projectId: string | null,
    userIds: readonly string[],
    message: string,
  ): Promise<void> {
    const wanted = [...new Set(userIds)];
    const visible = new Set(await this.filterVisibleTo(workspaceId, projectId, wanted));
    const hidden = wanted.filter((userId) => !visible.has(userId));

    if (hidden.length > 0) {
      throw AppException.badRequest('BAD_REQUEST', message, { userIds: hidden });
    }
  }

  /**
   * Everyone a private project's events may reach: its members plus the
   * workspace's OWNER and ADMIN. Distinct, in no particular order.
   */
  async audienceUserIds(workspaceId: string, projectId: string): Promise<string[]> {
    const [members, admins] = await Promise.all([
      this.prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } }),
      this.prisma.workspaceMember.findMany({
        where: { workspaceId, role: { in: ADMIN_ROLES } },
        select: { userId: true },
      }),
    ]);

    return [...new Set([...members, ...admins].map((row) => row.userId))];
  }

  /**
   * For the socket gateway: may `userId` join the project's room? Checks the
   * workspace membership and the project's visibility in one query, without a
   * role in hand.
   */
  async canJoinProject(projectId: string, userId: string): Promise<boolean> {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        AND: [{ workspace: { members: { some: { userId } } } }, this.projectWhere({ userId })],
      },
      select: { id: true },
    });

    return project !== null;
  }
}
