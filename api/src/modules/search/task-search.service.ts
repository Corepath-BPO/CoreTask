import {
  SEARCH_ME,
  SEARCH_NOBODY,
  SEARCH_RESULTS_LIMIT,
  SearchCompletion,
  SearchDue,
  SearchSort,
  type TaskSearchFilters,
} from '@coretask/contracts';
import type { TaskSearchPage } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The searcher's today as the UTC midnight due dates are stored at. */
function startOfDay(today: string | undefined): Date {
  const valid = today && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : null;
  return new Date(`${valid ?? new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
}

const ORDER: Record<SearchSort, Prisma.TaskOrderByWithRelationInput[]> = {
  DUE_DATE: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
  CREATED: [{ createdAt: 'desc' }],
  UPDATED: [{ updatedAt: 'desc' }],
  TITLE: [{ title: 'asc' }],
};

/**
 * Advanced search: tasks matching every filter given, among those the
 * searcher can see — the scope every task list applies, so a private project
 * stays private and a task linked into an open project is found there.
 * Archived tasks, and tasks in archived projects, are left out.
 *
 * With no status chosen it shows incomplete work, as Asana's does.
 */
@Injectable()
export class TaskSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async run(
    workspaceId: string,
    actor: ActorContext,
    filters: TaskSearchFilters,
    today?: string,
  ): Promise<TaskSearchPage> {
    const where = this.where(workspaceId, actor, filters, today);
    const [rows, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        orderBy: ORDER[filters.sort ?? SearchSort.DUE_DATE],
        take: SEARCH_RESULTS_LIMIT,
        select: {
          id: true,
          title: true,
          completedAt: true,
          dueDate: true,
          updatedAt: true,
          project: { select: { id: true, name: true, color: true } },
          parentTask: { select: { title: true } },
          assignee: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      }),
      this.prisma.task.count({ where }),
    ]);

    return {
      total,
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        completedAt: row.completedAt?.toISOString() ?? null,
        dueDate: row.dueDate?.toISOString() ?? null,
        project: row.project,
        parentTitle: row.parentTask?.title ?? null,
        assignee: row.assignee,
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }

  where(
    workspaceId: string,
    actor: ActorContext,
    filters: TaskSearchFilters,
    today?: string,
  ): Prisma.TaskWhereInput {
    const people = (ids: string[]) => ids.map((id) => (id === SEARCH_ME ? actor.userId : id));
    const and: Prisma.TaskWhereInput[] = [
      { OR: [{ projectId: null }, { project: { archivedAt: null } }] },
      this.access.taskWhere(actor),
    ];

    if (filters.text) {
      and.push({
        OR: [
          { title: { contains: filters.text, mode: 'insensitive' } },
          { description: { contains: filters.text, mode: 'insensitive' } },
        ],
      });
    }

    if (filters.assigneeIds?.length) {
      const named = people(filters.assigneeIds.filter((id) => id !== SEARCH_NOBODY));
      and.push({
        OR: [
          ...(named.length > 0 ? [{ assigneeId: { in: named } }] : []),
          ...(filters.assigneeIds.includes(SEARCH_NOBODY) ? [{ assigneeId: null }] : []),
        ],
      });
    }

    if (filters.projectIds?.length) {
      and.push({
        OR: [
          { projectId: { in: filters.projectIds } },
          { projectLinks: { some: { projectId: { in: filters.projectIds } } } },
        ],
      });
    }

    if (filters.tagIds?.length) {
      and.push({ tags: { some: { tagId: { in: filters.tagIds } } } });
    }

    const completion = filters.completion ?? SearchCompletion.INCOMPLETE;
    if (completion === SearchCompletion.INCOMPLETE) and.push({ completedAt: null });
    if (completion === SearchCompletion.COMPLETED) and.push({ completedAt: { not: null } });

    const start = startOfDay(today);
    switch (filters.due) {
      case SearchDue.OVERDUE:
        and.push({ dueDate: { lt: start } });
        break;
      case SearchDue.TODAY:
        and.push({ dueDate: { gte: start, lt: new Date(start.getTime() + DAY_MS) } });
        break;
      case SearchDue.NEXT_7_DAYS:
        and.push({ dueDate: { gte: start, lt: new Date(start.getTime() + 7 * DAY_MS) } });
        break;
      case SearchDue.NO_DATE:
        and.push({ dueDate: null });
        break;
      default:
        break;
    }

    if (filters.createdByIds?.length) {
      and.push({ createdById: { in: people(filters.createdByIds) } });
    }
    if (filters.collaboratorIds?.length) {
      and.push({ followers: { some: { userId: { in: people(filters.collaboratorIds) } } } });
    }

    return { workspaceId, archivedAt: null, AND: and };
  }
}
