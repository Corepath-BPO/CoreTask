import {
  ActivityAction,
  ActivityEntity,
  nextOccurrenceDay,
  readRecurrence,
  type CalendarDay,
} from '@coretask/contracts';
import { Logger } from '@nestjs/common';
import { StatusCategory, TaskStatus, type Prisma, type PrismaClient } from '@prisma/client';

import { appendPosition } from '../../common/utils/position.util';

import { endOfSection } from './task-projects';

const logger = new Logger('TaskRecurrence');

/** Thrown inside the transaction when another writer created the successor first. */
class AlreadyRepeated extends Error {}

const utcDay = (date: Date): CalendarDay => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

const atUtcMidnight = (day: CalendarDay) => new Date(Date.UTC(day.year, day.month - 1, day.day));

/**
 * Asana's "Set to repeat": a repeating task that was just completed creates
 * the next one.
 *
 * Called from every path that completes a task — a person's edit in the pane,
 * a cell or bulk edit on the list, a rule — and safe to call from all of them:
 * the successor is created and claimed (`nextOccurrenceId`) in one
 * transaction, so a second call finds the claim and does nothing, and so does
 * completing the same task again after reopening it.
 *
 * The next task carries what describes the work — name, notes, place, owner,
 * priority, estimate, field values, collaborators and its subtasks, open
 * again — and the repeat itself. Its dates move by the pattern; a start date
 * keeps its distance from the due date, and a due time keeps its hour.
 *
 * Never throws: the completion that called it has already happened, and a
 * repeat that fails to appear is logged rather than turned into a failed edit.
 */
export async function spawnNextOccurrence(
  prisma: PrismaClient,
  taskId: string,
  actorId: string | null,
): Promise<string | null> {
  try {
    return await spawn(prisma, taskId, actorId);
  } catch (error) {
    if (error instanceof AlreadyRepeated) return null;
    logger.error(
      { err: error, taskId },
      'Could not create the next occurrence of a repeating task',
    );
    return null;
  }
}

async function spawn(
  prisma: PrismaClient,
  taskId: string,
  actorId: string | null,
): Promise<string | null> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      customFieldValues: true,
      followers: { select: { userId: true } },
      subtasks: {
        where: { archivedAt: null },
        orderBy: [{ position: 'asc' }, { id: 'asc' }],
        select: {
          title: true,
          description: true,
          assigneeId: true,
          priority: true,
          priorityDefinitionId: true,
          estimatedMinutes: true,
          position: true,
        },
      },
    },
  });

  if (!task || !task.completedAt || task.nextOccurrenceId || task.archivedAt) return null;

  const recurrence = readRecurrence(task.recurrence);
  if (!recurrence) return null;

  const nextDue = atUtcMidnight(
    nextOccurrenceDay(
      recurrence,
      task.dueDate ? utcDay(task.dueDate) : null,
      utcDay(task.completedAt),
    ),
  );
  // How far the whole schedule moves; without a due date the start has
  // nothing to keep its distance from, so it is left off.
  const shift = task.dueDate ? nextDue.getTime() - task.dueDate.getTime() : null;
  const moved = (date: Date | null) =>
    date && shift !== null ? new Date(date.getTime() + shift) : null;

  const status = await openStatus(prisma, task);

  const siblings = await prisma.task.findMany({
    where: {
      workspaceId: task.workspaceId,
      archivedAt: null,
      ...(task.parentTaskId
        ? { parentTaskId: task.parentTaskId }
        : task.parentTicketId
          ? { parentTicketId: task.parentTicketId }
          : task.sectionId
            ? { parentTaskId: null, parentTicketId: null, sectionId: task.sectionId }
            : {
                parentTaskId: null,
                parentTicketId: null,
                projectId: task.projectId,
                sectionId: null,
              }),
    },
    orderBy: { position: 'asc' },
    select: { id: true, position: true },
  });

  const createdById = actorId ?? task.createdById;

  return prisma.$transaction(async (tx) => {
    const created = await tx.task.create({
      data: {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        sectionId: task.sectionId,
        parentTaskId: task.parentTaskId,
        parentTicketId: task.parentTicketId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        priorityDefinitionId: task.priorityDefinitionId,
        estimatedMinutes: task.estimatedMinutes,
        assigneeId: task.assigneeId,
        createdById,
        recurrence: task.recurrence as Prisma.InputJsonValue,
        dueDate: nextDue,
        dueAt: moved(task.dueAt),
        startDate: moved(task.startDate),
        startAt: moved(task.startAt),
        position: appendPosition(siblings),
        ...status,
      },
    });

    const claimed = await tx.task.updateMany({
      where: { id: task.id, nextOccurrenceId: null },
      data: { nextOccurrenceId: created.id },
    });
    if (claimed.count === 0) throw new AlreadyRepeated();

    if (task.customFieldValues.length > 0) {
      await tx.taskCustomFieldValue.createMany({
        data: task.customFieldValues.map((value) => ({
          taskId: created.id,
          customFieldId: value.customFieldId,
          textValue: value.textValue,
          numberValue: value.numberValue,
          dateValue: value.dateValue,
          booleanValue: value.booleanValue,
          optionIds: value.optionIds,
          userIds: value.userIds,
          updatedById: value.updatedById,
        })),
      });
    }

    // The next one is in every project this one is in, each in its section
    // there, at the end of it.
    const links = task.parentTaskId
      ? []
      : await tx.taskProject.findMany({
          where: { taskId: task.id },
          select: { projectId: true, sectionId: true },
        });
    for (const link of links) {
      await tx.taskProject.create({
        data: {
          taskId: created.id,
          projectId: link.projectId,
          sectionId: link.sectionId,
          position: await endOfSection(tx, task.workspaceId, link.projectId, link.sectionId),
        },
      });
    }

    if (task.followers.length > 0) {
      await tx.follower.createMany({
        data: task.followers.map((follower) => ({
          workspaceId: task.workspaceId,
          userId: follower.userId,
          taskId: created.id,
          ticketId: null,
        })),
        skipDuplicates: true,
      });
    }

    if (task.subtasks.length > 0) {
      await tx.task.createMany({
        data: task.subtasks.map((subtask) => ({
          workspaceId: task.workspaceId,
          projectId: task.projectId,
          sectionId: task.sectionId,
          parentTaskId: created.id,
          title: subtask.title,
          description: subtask.description,
          assigneeId: subtask.assigneeId,
          priority: subtask.priority,
          priorityDefinitionId: subtask.priorityDefinitionId,
          estimatedMinutes: subtask.estimatedMinutes,
          position: subtask.position,
          createdById,
          ...status,
        })),
      });
    }

    await tx.activityLog.create({
      data: {
        workspaceId: task.workspaceId,
        actorId,
        action: ActivityAction.CREATED,
        entity: ActivityEntity.TASK,
        entityId: created.id,
        projectId: task.projectId,
        summary:
          `Created "${task.title}" as the next repeat, due ${nextDue.toISOString().slice(0, 10)}`.slice(
            0,
            500,
          ),
        metadata: { repeatOf: task.id, dueDate: nextDue.toISOString() },
      },
    });

    return created.id;
  });
}

/**
 * The status a fresh occurrence opens on: the project's first not-started
 * status, or its first active one, when it defines its own; To do otherwise.
 */
async function openStatus(
  prisma: PrismaClient,
  task: { workspaceId: string; projectId: string | null; statusDefinitionId: string | null },
): Promise<{ status: TaskStatus; statusDefinitionId?: string | null }> {
  if (!task.statusDefinitionId) return { status: TaskStatus.TODO };

  const select = { id: true, category: true } as const;
  const own = task.projectId
    ? await prisma.statusDefinition.findMany({
        where: { workspaceId: task.workspaceId, projectId: task.projectId, isArchived: false },
        orderBy: { position: 'asc' },
        select,
      })
    : [];
  const set =
    own.length > 0
      ? own
      : await prisma.statusDefinition.findMany({
          where: { workspaceId: task.workspaceId, projectId: null, isArchived: false },
          orderBy: { position: 'asc' },
          select,
        });

  const open =
    set.find((row) => row.category === StatusCategory.NOT_STARTED) ??
    set.find((row) => row.category === StatusCategory.ACTIVE);

  return { status: TaskStatus.TODO, statusDefinitionId: open?.id ?? null };
}
