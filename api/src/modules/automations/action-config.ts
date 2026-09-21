import { StatusCategory, TaskPriority, TaskStatus } from '@prisma/client';

import type { PrismaService } from '../../database/prisma.service';

/**
 * What an action's settings are called, and how to read them.
 *
 * The builder and the runner disagreed about the names for three actions: the
 * form wrote `statusDefinitionId`, `priorityDefinitionId` and `customFieldId`
 * while the runner read `status`, `priority` and `fieldId`. Nothing crossed the
 * gap, so "change the status" published cleanly, ran, and set the status to an
 * empty string — a failure with no error attached to it.
 *
 * The runner's spelling wins, for a reason beyond seniority: the value is a
 * status *id*, and an id here is legitimately either a definition's uuid or a
 * legacy enum name, because a workspace with no definitions of its own is
 * offered the enums. `statusDefinitionId` would therefore be a lie for half the
 * values it held, and a name that is wrong half the time is worse than a short
 * one. `TaskWorkItemRepository.statusData` settled this convention first; this
 * follows it rather than inventing a second answer.
 */
export const LEGACY_ACTION_KEYS: Readonly<Record<string, string>> = {
  status: 'statusDefinitionId',
  priority: 'priorityDefinitionId',
  fieldId: 'customFieldId',
};

/**
 * An action's setting, under its own name or the one it used to have.
 *
 * Rules written before the names were reconciled are still in the database and
 * still running, so reading only the canonical key would break them at exactly
 * the moment this stopped being broken. The migration rewrites what it can
 * reach; this covers what it cannot — a draft in somebody's browser, a rule
 * restored from a backup, an integration posting the older shape.
 */
export function readActionId(
  configuration: Record<string, unknown>,
  key: 'status' | 'priority' | 'fieldId',
): string | null {
  const legacy = LEGACY_ACTION_KEYS[key];

  for (const candidate of legacy ? [key, legacy] : [key]) {
    const value = configuration[candidate];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }

  return null;
}

/**
 * Which column a chosen status belongs in.
 *
 * A task carries both a legacy enum and a definition, and which one is
 * authoritative depends on whether the workspace has defined its own. Writing
 * the uuid into the enum column throws; writing the enum name into the
 * definition column violates the foreign key. So the id decides, exactly as it
 * does on the path a person drives.
 */
export function statusData(statusId: string): {
  status?: TaskStatus;
  statusDefinitionId?: string;
} {
  if (statusId in TaskStatus) return { status: statusId as TaskStatus };

  // The scalar rather than a `connect`, because this is spread into an update
  // and the relation form is not valid there.
  return { statusDefinitionId: statusId };
}

/**
 * Whether a chosen status means the task is finished, and what that does to
 * `completedAt`.
 *
 * The same two shapes as `statusData`, and the same reason they both have to
 * work: an enum name answers for itself, while a definition's uuid answers
 * through its category. Reading only the enum left every workspace that had
 * defined its own statuses — which is every workspace that ever opened the
 * status editor — with rules that moved a task to Done and left it
 * uncompleted, so the dashboard's count, the completion filters and
 * `TASK_COMPLETED` all disagreed with the board.
 *
 * Stamped once on the way in and cleared on the way out, so the timestamp
 * means the moment it was finished rather than the last time a rule touched
 * it. `TaskWorkItemRepository.completionData` is the same rule on the path a
 * person drives; this is it for the path a rule drives.
 */
export async function completionData(
  prisma: PrismaService,
  statusId: string,
  completedAt: Date | null,
): Promise<{ completedAt?: Date | null }> {
  const done =
    statusId in TaskStatus
      ? statusId === TaskStatus.DONE
      : (
          await prisma.statusDefinition.findFirst({
            where: { id: statusId },
            select: { category: true },
          })
        )?.category === StatusCategory.COMPLETED;

  if (done && completedAt === null) return { completedAt: new Date() };
  if (!done && completedAt !== null) return { completedAt: null };

  return {};
}

export function priorityData(priorityId: string): {
  priority?: TaskPriority;
  priorityDefinitionId?: string;
} {
  if (priorityId in TaskPriority) return { priority: priorityId as TaskPriority };

  return { priorityDefinitionId: priorityId };
}
