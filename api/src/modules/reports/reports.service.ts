import {
  MAX_REPORT_CHART_PROJECTS,
  MAX_REPORT_CHARTS,
  MAX_REPORT_DASHBOARDS,
  REPORT_CHART_KINDS,
  REPORT_CHART_TITLE_MAX,
  REPORT_COMPLETIONS,
  REPORT_GROUP_BYS,
  REPORT_WEEKS,
  ReportChartKind,
  ReportCompletion,
  ReportGroupBy,
  WorkspaceRole,
  chartKindFits,
  hasAtLeastRole,
} from '@coretask/contracts';
import type {
  ReportChart,
  ReportDashboard,
  ReportDashboardDraft,
  ReportQuery,
  ReportResult,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** The most tasks one chart reads; past it the answer would be slow, not wrong in kind. */
const MAX_REPORT_TASKS = 20_000;

/** Legacy enum labels, for tasks without a defined status or priority. */
const humanize = (value: string) =>
  value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');

/** Monday 00:00 UTC of the week holding `time`. */
function weekStart(time: number): number {
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7; // Monday is 0
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day);
}

const WEEK_LABEL = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const ownerSelect = { select: { id: true, name: true, avatarUrl: true } } as const;

type DashboardRow = Prisma.ReportDashboardGetPayload<{ include: { owner: typeof ownerSelect } }>;

/** A stored chart, read leniently and made whole — never trusted as it came in. */
function readChart(value: unknown): ReportChart | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const kind = REPORT_CHART_KINDS.includes(record['kind'] as ReportChartKind)
    ? (record['kind'] as ReportChartKind)
    : null;
  const groupBy = REPORT_GROUP_BYS.includes(record['groupBy'] as ReportGroupBy)
    ? (record['groupBy'] as ReportGroupBy)
    : null;
  if (!kind || !groupBy || !chartKindFits(kind, groupBy)) return null;
  const title = typeof record['title'] === 'string' ? record['title'].trim() : '';
  return {
    id: typeof record['id'] === 'string' && record['id'] ? record['id'] : randomUUID(),
    title: title.slice(0, REPORT_CHART_TITLE_MAX) || 'Untitled chart',
    kind,
    groupBy,
    completion: REPORT_COMPLETIONS.includes(record['completion'] as ReportCompletion)
      ? (record['completion'] as ReportCompletion)
      : ReportCompletion.ALL,
    projectIds: Array.isArray(record['projectIds'])
      ? [
          ...new Set(
            (record['projectIds'] as unknown[]).filter(
              (id): id is string => typeof id === 'string',
            ),
          ),
        ].slice(0, MAX_REPORT_CHART_PROJECTS)
      : [],
    overdueOnly: record['overdueOnly'] === true,
  };
}

const readCharts = (value: unknown): ReportChart[] =>
  Array.isArray(value)
    ? value.flatMap((entry) => readChart(entry) ?? []).slice(0, MAX_REPORT_CHARTS)
    : [];

function toDashboard(row: DashboardRow): ReportDashboard {
  return {
    id: row.id,
    name: row.name,
    owner: row.owner,
    charts: readCharts(row.charts),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Report dashboards — Asana's Reporting.
 *
 * Dashboards are the workspace's, like portfolios: everyone sees them, members
 * make them, and their owner or a manager changes them. A chart's numbers are
 * computed here, per reader, over the tasks that reader may see — the same
 * scope the task list uses — so a dashboard shared with someone outside a
 * private project shows them a smaller, still true, picture.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  // -------------------------------------------------------------------------
  // Dashboards
  // -------------------------------------------------------------------------

  async list(workspaceId: string): Promise<ReportDashboard[]> {
    const rows = await this.prisma.reportDashboard.findMany({
      where: { workspaceId },
      include: { owner: ownerSelect },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDashboard);
  }

  async create(
    workspaceId: string,
    actor: ActorContext,
    draft: ReportDashboardDraft,
  ): Promise<ReportDashboard> {
    if (!hasAtLeastRole(actor.role, WorkspaceRole.MEMBER)) {
      throw AppException.forbidden('FORBIDDEN', 'Guests cannot make dashboards.');
    }
    if (
      (await this.prisma.reportDashboard.count({ where: { workspaceId } })) >= MAX_REPORT_DASHBOARDS
    ) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        `A workspace holds up to ${MAX_REPORT_DASHBOARDS} dashboards.`,
      );
    }
    const row = await this.prisma.reportDashboard.create({
      data: {
        workspaceId,
        name: draft.name.trim(),
        ownerId: actor.userId,
        charts: readCharts(draft.charts ?? []) as unknown as Prisma.InputJsonValue,
      },
      include: { owner: ownerSelect },
    });
    return toDashboard(row);
  }

  async update(
    workspaceId: string,
    dashboardId: string,
    actor: ActorContext,
    draft: Partial<ReportDashboardDraft>,
  ): Promise<ReportDashboard> {
    await this.requireMayChange(workspaceId, dashboardId, actor);
    const row = await this.prisma.reportDashboard.update({
      where: { id: dashboardId },
      data: {
        ...(draft.name !== undefined ? { name: draft.name.trim() } : {}),
        ...(draft.charts !== undefined
          ? { charts: readCharts(draft.charts) as unknown as Prisma.InputJsonValue }
          : {}),
      },
      include: { owner: ownerSelect },
    });
    return toDashboard(row);
  }

  async remove(workspaceId: string, dashboardId: string, actor: ActorContext): Promise<void> {
    await this.requireMayChange(workspaceId, dashboardId, actor);
    await this.prisma.reportDashboard.delete({ where: { id: dashboardId } });
  }

  // -------------------------------------------------------------------------
  // Numbers
  // -------------------------------------------------------------------------

  /** One chart's answer, over the top-level tasks the reader can see. */
  async tasks(
    workspaceId: string,
    actor: ActorContext,
    query: ReportQuery,
    now = new Date(),
  ): Promise<ReportResult> {
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

    const where: Prisma.TaskWhereInput = {
      workspaceId,
      AND: [
        this.access.taskWhere(actor),
        // A project's tasks include those linked into it (multi-homing).
        ...(query.projectIds.length > 0
          ? [
              {
                OR: [
                  { projectId: { in: query.projectIds } },
                  { projectLinks: { some: { projectId: { in: query.projectIds } } } },
                ],
              },
            ]
          : []),
      ],
      archivedAt: null,
      parentTaskId: null,
      ...(query.completion === ReportCompletion.OPEN ? { completedAt: null } : {}),
      ...(query.completion === ReportCompletion.DONE ? { completedAt: { not: null } } : {}),
      ...(query.overdueOnly ? { completedAt: null, dueDate: { lt: new Date(today) } } : {}),
    };

    const tasks = await this.prisma.task.findMany({
      where,
      select: {
        status: true,
        statusDefinitionId: true,
        priority: true,
        priorityDefinitionId: true,
        assigneeId: true,
        projectId: true,
        dueDate: true,
        completedAt: true,
      },
      take: MAX_REPORT_TASKS,
    });

    const total = tasks.length;
    const tally = new Map<string, number>();
    const add = (key: string) => tally.set(key, (tally.get(key) ?? 0) + 1);

    switch (query.groupBy) {
      case ReportGroupBy.NONE:
        return { total, groups: [] };

      case ReportGroupBy.STATUS: {
        for (const task of tasks) add(task.statusDefinitionId ?? `enum:${task.status}`);
        const defined = await this.prisma.statusDefinition.findMany({
          where: { id: { in: [...tally.keys()].filter((key) => !key.startsWith('enum:')) } },
          select: { id: true, name: true, colorToken: true, position: true },
        });
        const byId = new Map(defined.map((row) => [row.id, row]));
        return {
          total,
          groups: [...tally.entries()]
            .map(([key, count]) => {
              const row = byId.get(key);
              return {
                key,
                label: row?.name ?? humanize(key.replace('enum:', '')),
                count,
                color: row?.colorToken ?? null,
                order: row?.position ?? Number.MAX_SAFE_INTEGER,
              };
            })
            .sort((a, b) => a.order - b.order || b.count - a.count)
            .map(({ order: _order, ...group }) => group),
        };
      }

      case ReportGroupBy.PRIORITY: {
        for (const task of tasks) add(task.priorityDefinitionId ?? `enum:${task.priority}`);
        const defined = await this.prisma.priorityDefinition.findMany({
          where: { id: { in: [...tally.keys()].filter((key) => !key.startsWith('enum:')) } },
          select: { id: true, name: true, colorToken: true, level: true },
        });
        const byId = new Map(defined.map((row) => [row.id, row]));
        return {
          total,
          groups: [...tally.entries()]
            .map(([key, count]) => {
              const row = byId.get(key);
              return {
                key,
                label: row?.name ?? humanize(key.replace('enum:', '')),
                count,
                color: row?.colorToken ?? null,
                order: row ? -row.level : Number.MAX_SAFE_INTEGER,
              };
            })
            .sort((a, b) => a.order - b.order || b.count - a.count)
            .map(({ order: _order, ...group }) => group),
        };
      }

      case ReportGroupBy.ASSIGNEE: {
        for (const task of tasks) add(task.assigneeId ?? 'none');
        const users = await this.prisma.user.findMany({
          where: { id: { in: [...tally.keys()].filter((key) => key !== 'none') } },
          select: { id: true, name: true },
        });
        const name = new Map(users.map((user) => [user.id, user.name]));
        return {
          total,
          groups: this.byCount(tally, (key) =>
            key === 'none' ? 'Unassigned' : (name.get(key) ?? 'Former member'),
          ),
        };
      }

      case ReportGroupBy.PROJECT: {
        for (const task of tasks) add(task.projectId ?? 'none');
        const projects = await this.prisma.project.findMany({
          where: { id: { in: [...tally.keys()].filter((key) => key !== 'none') } },
          select: { id: true, name: true, color: true },
        });
        const byId = new Map(projects.map((project) => [project.id, project]));
        return {
          total,
          groups: this.byCount(
            tally,
            (key) => (key === 'none' ? 'No project' : (byId.get(key)?.name ?? 'Project')),
            (key) => byId.get(key)?.color ?? null,
          ),
        };
      }

      case ReportGroupBy.DUE_WEEK:
      case ReportGroupBy.COMPLETED_WEEK: {
        const due = query.groupBy === ReportGroupBy.DUE_WEEK;
        // Due dates look ahead from this week; completions look back to it.
        const first = due ? weekStart(today) : weekStart(today) - (REPORT_WEEKS - 1) * WEEK_MS;
        const weeks = Array.from({ length: REPORT_WEEKS }, (_, index) => first + index * WEEK_MS);
        for (const week of weeks) tally.set(String(week), 0);

        for (const task of tasks) {
          const at = due ? task.dueDate : task.completedAt;
          if (!at) continue;
          const week = weekStart(at.getTime());
          if (tally.has(String(week))) add(String(week));
        }
        return {
          total,
          groups: weeks.map((week) => ({
            key: new Date(week).toISOString().slice(0, 10),
            label: WEEK_LABEL.format(new Date(week)),
            count: tally.get(String(week)) ?? 0,
            color: null,
          })),
        };
      }
    }
  }

  // -------------------------------------------------------------------------

  private byCount(
    tally: Map<string, number>,
    label: (key: string) => string,
    color: (key: string) => string | null = () => null,
  ): ReportResult['groups'] {
    return [...tally.entries()]
      .map(([key, count]) => ({ key, label: label(key), count, color: color(key) }))
      .sort((a, b) => {
        // The "nobody" bucket last: it is nobody's to compare.
        if ((a.key === 'none') !== (b.key === 'none')) return a.key === 'none' ? 1 : -1;
        return b.count - a.count || a.label.localeCompare(b.label);
      });
  }

  private async requireMayChange(workspaceId: string, dashboardId: string, actor: ActorContext) {
    const row = await this.prisma.reportDashboard.findFirst({
      where: { id: dashboardId, workspaceId },
      select: { ownerId: true },
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Dashboard not found.');
    if (row.ownerId !== actor.userId && !hasAtLeastRole(actor.role, WorkspaceRole.MANAGER)) {
      throw AppException.forbidden(
        'FORBIDDEN',
        'Only the dashboard’s owner or a manager can change it.',
      );
    }
  }
}
