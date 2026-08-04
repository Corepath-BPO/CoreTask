/**
 * Backfills status and priority definitions from the legacy enums.
 *
 * Run after `prisma migrate deploy`:
 *
 *   docker exec -w /app/api coretask-api npx tsx prisma/backfill-definitions.ts
 *
 * Deliberately a script rather than SQL inside the migration. It has to be
 * re-runnable, it has to report what it changed, and it has to be verifiable
 * before anything starts reading the new columns — none of which a one-shot
 * migration gives you.
 *
 * Idempotent: nothing is written that already exists, so running it twice
 * changes nothing and reports zero the second time. It never writes to
 * `Task.status` or `Task.priority`; those stay authoritative until the
 * cut-over.
 */
import {
  DEFAULT_PRIORITY_DEFINITIONS,
  DEFAULT_STATUS_DEFINITIONS,
  TaskPriority,
  TaskStatus,
} from '@coretask/contracts';
import { PrismaClient, type StatusCategory } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Legacy enum value to definition slug.
 *
 * Exhaustive by construction: `Record<TaskStatus, string>` fails to compile if
 * a status is added to the enum without a mapping here, which is the failure
 * that would otherwise leave tasks silently unlinked.
 */
const STATUS_SLUG: Record<TaskStatus, string> = {
  [TaskStatus.BACKLOG]: 'backlog',
  [TaskStatus.TODO]: 'todo',
  [TaskStatus.IN_PROGRESS]: 'in-progress',
  [TaskStatus.IN_REVIEW]: 'in-review',
  [TaskStatus.BLOCKED]: 'blocked',
  [TaskStatus.DONE]: 'done',
  [TaskStatus.CANCELLED]: 'cancelled',
};

const PRIORITY_SLUG: Record<TaskPriority, string> = {
  [TaskPriority.NONE]: 'none',
  [TaskPriority.LOW]: 'low',
  [TaskPriority.MEDIUM]: 'medium',
  [TaskPriority.HIGH]: 'high',
  [TaskPriority.CRITICAL]: 'critical',
};

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function main(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({ select: { id: true, name: true } });
  console.log(`Backfilling ${workspaces.length} workspace(s)\n`);

  let statusesWritten = 0;
  let prioritiesWritten = 0;
  let tasksLinked = 0;

  for (const workspace of workspaces) {
    // --- definitions -------------------------------------------------------
    for (const [index, definition] of DEFAULT_STATUS_DEFINITIONS.entries()) {
      /*
       * `findFirst` then `create`, not `upsert`. Prisma refuses null inside a
       * compound-unique `where`, and Postgres would not enforce it anyway —
       * NULL never equals NULL in a unique constraint, so the composite index
       * does not constrain the workspace-level rows at all. A partial unique
       * index covers that (see the add_status_definition_workspace_unique
       * migration); this is the matching read.
       *
       * Existing rows are left alone: a workspace may have renamed or
       * recoloured a status, and a re-run must not undo that.
       */
      const existing = await prisma.statusDefinition.findFirst({
        where: { workspaceId: workspace.id, projectId: null, slug: definition.slug },
        select: { id: true },
      });

      if (!existing) {
        await prisma.statusDefinition.create({
          data: {
            workspaceId: workspace.id,
            name: definition.name,
            slug: definition.slug,
            category: definition.category as StatusCategory,
            colorToken: definition.colorToken,
            position: index,
            isDefault: definition.isDefault,
          },
        });
        statusesWritten += 1;
      }
    }

    for (const [index, definition] of DEFAULT_PRIORITY_DEFINITIONS.entries()) {
      const slug = slugify(definition.name);
      // Counted only when something is actually written, so the report can
      // distinguish a real run from a no-op re-run. That distinction is the
      // whole value of the report.
      const existing = await prisma.priorityDefinition.findUnique({
        where: { workspaceId_slug: { workspaceId: workspace.id, slug } },
        select: { id: true },
      });

      if (!existing) {
        await prisma.priorityDefinition.create({
          data: {
            workspaceId: workspace.id,
            name: definition.name,
            slug,
            level: definition.level,
            colorToken: definition.colorToken,
            position: index,
            isDefault: definition.isDefault,
          },
        });
        prioritiesWritten += 1;
      }
    }

    // --- link tasks --------------------------------------------------------
    const statuses = await prisma.statusDefinition.findMany({
      where: { workspaceId: workspace.id, projectId: null },
      select: { id: true, slug: true },
    });
    const priorities = await prisma.priorityDefinition.findMany({
      where: { workspaceId: workspace.id },
      select: { id: true, slug: true },
    });

    const statusId = new Map(statuses.map((row) => [row.slug, row.id]));
    const priorityId = new Map(priorities.map((row) => [row.slug, row.id]));

    /*
     * One updateMany per (status, priority) pair rather than a row-by-row loop:
     * a workspace can hold tens of thousands of tasks, and this is bounded by
     * the size of the enums instead.
     */
    for (const legacyStatus of Object.values(TaskStatus)) {
      const target = statusId.get(STATUS_SLUG[legacyStatus]);
      if (!target) throw new Error(`No definition for status ${legacyStatus}`);

      const { count } = await prisma.task.updateMany({
        where: {
          workspaceId: workspace.id,
          status: legacyStatus,
          // Only rows not already linked, so a re-run costs nothing and cannot
          // overwrite a status set through the new path.
          statusDefinitionId: null,
        },
        data: { statusDefinitionId: target },
      });
      tasksLinked += count;
    }

    for (const legacyPriority of Object.values(TaskPriority)) {
      const target = priorityId.get(PRIORITY_SLUG[legacyPriority]);
      if (!target) throw new Error(`No definition for priority ${legacyPriority}`);

      await prisma.task.updateMany({
        where: {
          workspaceId: workspace.id,
          priority: legacyPriority,
          priorityDefinitionId: null,
        },
        data: { priorityDefinitionId: target },
      });
    }

    console.log(`  ${workspace.name}: linked`);
  }

  // --- verification --------------------------------------------------------
  // The point of the exercise. An unlinked row means a task whose status the
  // new code cannot read, so this reports rather than assumes.
  const [total, missingStatus, missingPriority] = await Promise.all([
    prisma.task.count(),
    prisma.task.count({ where: { statusDefinitionId: null } }),
    prisma.task.count({ where: { priorityDefinitionId: null } }),
  ]);

  console.log(`\nStatus definitions created:    ${statusesWritten}`);
  console.log(`Priority definitions created:  ${prioritiesWritten}`);
  console.log(`Tasks newly linked:            ${tasksLinked}`);
  console.log(`\nTasks total:                   ${total}`);
  console.log(`Tasks without a status link:   ${missingStatus}`);
  console.log(`Tasks without a priority link: ${missingPriority}`);

  if (missingStatus > 0 || missingPriority > 0) {
    console.error('\nFAILED: some tasks are unlinked. Do not proceed to the cut-over.');
    process.exitCode = 1;
    return;
  }

  console.log('\nOK: every task is linked to a definition.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
