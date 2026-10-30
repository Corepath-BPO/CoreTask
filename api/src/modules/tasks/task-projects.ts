import { TaskStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { appendPosition } from '../../common/utils/position.util';

import { descendantIds } from './task-tree';

/**
 * Multi-homing — a task in several projects.
 *
 * A task keeps one home: `Task.projectId`, with its section and position on
 * the task row, which every older path reads. Each other project it is in is a
 * `TaskProject` row with a section and position of its own, so the same task
 * can sit in "Review" on one board and "This week" on another and be dragged
 * in each without disturbing the other.
 *
 * These helpers are the few rules every path has to agree on — what a
 * section's siblings are, what happens when the home is left — kept as plain
 * functions over a Prisma client so a transaction can use them too.
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** Where a task sits in one project: the home's columns, or its link's. */
export interface Placement {
  projectId: string;
  sectionId: string | null;
  position: number;
}

/**
 * Every top-level task in one section of one project, for placing another
 * among them: the tasks whose home it is, and the tasks linked into it with
 * their own positions there. Archived tasks are not siblings.
 */
export async function taskSiblingsIn(
  db: Db,
  workspaceId: string,
  projectId: string,
  sectionId: string | null,
): Promise<{ id: string; position: number; linked: boolean }[]> {
  const [home, linked] = await Promise.all([
    db.task.findMany({
      where: {
        workspaceId,
        projectId,
        sectionId,
        archivedAt: null,
        parentTaskId: null,
        parentTicketId: null,
      },
      select: { id: true, position: true },
    }),
    db.taskProject.findMany({
      where: {
        projectId,
        sectionId,
        task: { workspaceId, archivedAt: null, parentTaskId: null, parentTicketId: null },
      },
      select: { taskId: true, position: true },
    }),
  ]);
  return [
    ...home.map((task) => ({ ...task, linked: false })),
    ...linked.map((link) => ({ id: link.taskId, position: link.position, linked: true })),
  ];
}

/** The next position at the end of a section, counting both kinds of member. */
export async function endOfSection(
  db: Db,
  workspaceId: string,
  projectId: string,
  sectionId: string | null,
): Promise<number> {
  return appendPosition(await taskSiblingsIn(db, workspaceId, projectId, sectionId));
}

/**
 * The home has just become `projectId`: a link to that same project would be
 * the task listed twice, so it goes. Call after anything that changes a
 * task's home — a move to another project, a rule, a promotion.
 */
export async function dropLinkToHome(db: Db, taskId: string, projectId: string | null) {
  if (!projectId) return;
  await db.taskProject.deleteMany({ where: { taskId, projectId } });
}

/**
 * The task is leaving its home project. If it is in others, the one it joined
 * first becomes its home — section, position and all — and its subtasks follow
 * it there. If it is in none, it is left without a project, as removing a task
 * from its only project always has: still in My Tasks and search.
 *
 * Returns the new placement, or null when the task has no project left.
 */
export async function leaveHome(db: Db, taskId: string): Promise<Placement | null> {
  const next = await db.taskProject.findFirst({
    where: { taskId },
    orderBy: [{ addedAt: 'asc' }, { projectId: 'asc' }],
  });

  const placement: Placement | null = next
    ? { projectId: next.projectId, sectionId: next.sectionId, position: next.position }
    : null;

  if (next) {
    await db.taskProject.delete({
      where: { taskId_projectId: { taskId, projectId: next.projectId } },
    });
  }

  await db.task.update({
    where: { id: taskId },
    data: {
      projectId: placement?.projectId ?? null,
      sectionId: placement?.sectionId ?? null,
      ...(placement ? { position: placement.position } : {}),
    },
  });
  // Subtasks live with their parent's home, at every level.
  await db.task.updateMany({
    where: { id: { in: await descendantIds(db, [taskId]) } },
    data: { projectId: placement?.projectId ?? null, sectionId: placement?.sectionId ?? null },
  });

  return placement;
}

/** The projects a task is in besides its home, oldest first. */
export async function linkedProjectIds(db: Db, taskId: string): Promise<string[]> {
  const rows = await db.taskProject.findMany({
    where: { taskId },
    orderBy: { addedAt: 'asc' },
    select: { projectId: true },
  });
  return rows.map((row) => row.projectId);
}

/**
 * Every task in each project — at home there or linked in — and how many are
 * done. A project's progress counts the tasks on its board, wherever else they
 * also are.
 */
export async function projectTaskCounts(
  db: Db,
  projectIds: readonly string[],
): Promise<Map<string, { total: number; done: number }>> {
  const counts = new Map<string, { total: number; done: number }>();
  if (projectIds.length === 0) return counts;
  const ids = [...projectIds];

  const [homeAll, homeDone, linkAll, linkDone] = await Promise.all([
    db.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids } },
      _count: { _all: true },
    }),
    db.task.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, status: TaskStatus.DONE },
      _count: { _all: true },
    }),
    db.taskProject.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids } },
      _count: { _all: true },
    }),
    db.taskProject.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, task: { status: TaskStatus.DONE } },
      _count: { _all: true },
    }),
  ]);

  const bump = (projectId: string | null, key: 'total' | 'done', by: number) => {
    if (!projectId) return;
    const entry = counts.get(projectId) ?? { total: 0, done: 0 };
    entry[key] += by;
    counts.set(projectId, entry);
  };
  for (const row of homeAll) bump(row.projectId, 'total', row._count._all);
  for (const row of homeDone) bump(row.projectId, 'done', row._count._all);
  for (const row of linkAll) bump(row.projectId, 'total', row._count._all);
  for (const row of linkDone) bump(row.projectId, 'done', row._count._all);
  return counts;
}
