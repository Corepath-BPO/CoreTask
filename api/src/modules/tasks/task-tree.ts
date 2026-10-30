import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Subtasks nest to any depth, as Asana's do: a subtask can have subtasks of
 * its own. These walk the tree by `parentTaskId`, one level per query, and
 * never visit a task twice — a loop in the data, which nothing should make,
 * ends the walk instead of running it forever.
 *
 * Plain functions over a Prisma client, as `task-projects.ts` is, so a
 * transaction can use them too.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Every task under these, at any depth — not the tasks themselves. */
export async function descendantIds(db: Db, taskIds: readonly string[]): Promise<string[]> {
  const seen = new Set(taskIds);
  const found: string[] = [];
  let level = [...taskIds];
  while (level.length > 0) {
    const children = await db.task.findMany({
      where: { parentTaskId: { in: level } },
      select: { id: true },
    });
    level = children.map((row) => row.id).filter((id) => !seen.has(id));
    for (const id of level) {
      seen.add(id);
      found.push(id);
    }
  }
  return found;
}

/** The tasks above one, from the top-level task down to its parent. */
export async function ancestorsOf(
  db: Db,
  task: { parentTaskId: string | null },
): Promise<{ id: string; title: string }[]> {
  const chain: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  let next = task.parentTaskId;
  while (next && !seen.has(next)) {
    seen.add(next);
    const parent = await db.task.findUnique({
      where: { id: next },
      select: { id: true, title: true, parentTaskId: true },
    });
    if (!parent) break;
    chain.unshift({ id: parent.id, title: parent.title });
    next = parent.parentTaskId;
  }
  return chain;
}
