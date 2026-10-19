import type { PrismaService } from '../../../database/prisma.service';

/**
 * The statuses a project actually uses.
 *
 * Its own set when it has one, the workspace default set when it does not —
 * the same resolution `DefinitionsService.statusesFor` performs, because a
 * project's status list has one right answer and two places computing it
 * differently is how a rule comes to name a status the board never shows.
 *
 * This used to be `OR: [{ projectId }, { projectId: null }]`, which merged the
 * two: a project that had renamed its statuses saw its own words *and* the
 * workspace's, duplicated, with no way to tell which of the two "In review"
 * rows the rule would compare against. Archived rows came through as well.
 *
 * Shared by the builder's metadata and the "Use AI…" step, which offers the
 * model the same list the builder offers a person.
 */
export async function projectStatuses(
  prisma: PrismaService,
  workspaceId: string,
  projectId: string,
): Promise<{ id: string; name: string; colorToken: string }[]> {
  const select = { id: true, name: true, colorToken: true } as const;

  const own = await prisma.statusDefinition.findMany({
    where: { workspaceId, projectId, isArchived: false },
    orderBy: { position: 'asc' },
    select,
  });

  if (own.length > 0) return own;

  return prisma.statusDefinition.findMany({
    where: { workspaceId, projectId: null, isArchived: false },
    orderBy: { position: 'asc' },
    select,
  });
}
