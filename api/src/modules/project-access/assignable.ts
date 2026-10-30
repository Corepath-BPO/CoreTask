import { WorkspaceRole, type Prisma, type PrismaClient } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';

/**
 * Who work in a project may be given to.
 *
 * Its members, as Asana offers a project's members, and the workspace's
 * owner — whoever set the workspace up is assignable everywhere, member or
 * not. The pickers offer exactly this list (`FieldMetadataService`); the
 * helpers here hold every other way in — the API, rules, Slack, templates —
 * to the same line, so nothing hands work to someone the screen would not.
 *
 * Plain functions over a Prisma client, as `task-projects.ts` is, so any
 * service can ask without another dependency.
 */

type Db = PrismaClient | Prisma.TransactionClient;

export const NOT_ASSIGNABLE = 'Only members of this project can be assigned its work.';

/**
 * Everyone who may be given work in any of these projects — a task linked
 * into a second project may go to a member of either. Null for work in no
 * project, a personal task, which anyone in the workspace may be given.
 */
export async function assignableIds(
  db: Db,
  workspaceId: string,
  projectIds: readonly (string | null | undefined)[],
): Promise<Set<string> | null> {
  const projects = [...new Set(projectIds.filter((id): id is string => Boolean(id)))];
  if (projects.length === 0) return null;

  const [members, owners] = await Promise.all([
    db.projectMember.findMany({
      // A deactivated member keeps their project places for reactivation,
      // but nothing new goes to them.
      where: {
        projectId: { in: projects },
        user: { memberships: { some: { workspaceId, deactivatedAt: null } } },
      },
      select: { userId: true },
    }),
    db.workspaceMember.findMany({
      where: { workspaceId, role: WorkspaceRole.OWNER },
      select: { userId: true },
    }),
  ]);
  return new Set([...members, ...owners].map((row) => row.userId));
}

/** Whether `userId` may be given work in these projects. */
export async function isAssignable(
  db: Db,
  workspaceId: string,
  projectIds: readonly (string | null | undefined)[],
  userId: string,
): Promise<boolean> {
  const allowed = await assignableIds(db, workspaceId, projectIds);
  return allowed === null || allowed.has(userId);
}

/** 400 unless every one of `userIds` may be given work in these projects. */
export async function assertAssignable(
  db: Db,
  workspaceId: string,
  projectIds: readonly (string | null | undefined)[],
  userIds: readonly (string | null | undefined)[],
): Promise<void> {
  const wanted = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return;

  const allowed = await assignableIds(db, workspaceId, projectIds);
  if (allowed === null) return;

  const refused = wanted.filter((userId) => !allowed.has(userId));
  if (refused.length > 0) {
    throw AppException.badRequest('BAD_REQUEST', NOT_ASSIGNABLE, { userIds: refused });
  }
}
