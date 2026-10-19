import { randomBytes } from 'node:crypto';

import { API_PREFIX, ApiRoutes, type WorkspaceRole } from '@coretask/contracts';
import type { CalendarFeed } from '@coretask/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { ActorContext } from '../../common/types/api.types';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import { buildCalendar, type IcsEvent, type IcsWhen } from './ics';

const TOKEN_BYTES = 24;
/** Tasks due this long ago still show: last week's misses stay on the calendar. */
const LOOKBACK_DAYS = 30;
/** A calendar app is not a report; past this, the soonest due win. */
const MAX_EVENTS = 1000;
/** A task with a due time and no start shows as a block this long. */
const TIMED_MINUTES = 30;
/** `lastFetchedAt` is a hint, not a log; one write per this long is plenty. */
const FETCH_STAMP_MS = 5 * 60_000;

type FeedRow = Prisma.CalendarFeedGetPayload<object>;

/**
 * Calendar subscriptions — Asana's "Sync to calendar". A person gets a secret
 * link for their My Tasks, or for one project, that any calendar app can
 * subscribe to; tasks with a due date show as events.
 *
 * The link is the credential, so it only ever reads, and it reads as its owner
 * sees things *now*: a project they can no longer open, or a workspace they
 * have left, answers 404. Resetting a link replaces it; the old one stops.
 */
@Injectable()
export class CalendarFeedsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
    private readonly config: AppConfigService,
  ) {}

  async get(
    workspaceId: string,
    actor: ActorContext,
    projectId: string | null,
  ): Promise<CalendarFeed | null> {
    if (projectId) await this.access.resolveAccess(workspaceId, projectId, actor);
    const row = await this.find(workspaceId, actor.userId, projectId);
    return row ? this.toDto(row) : null;
  }

  /** The caller's link for this calendar, made on first ask. */
  async create(
    workspaceId: string,
    actor: ActorContext,
    projectId: string | null,
  ): Promise<CalendarFeed> {
    if (projectId) await this.access.resolveAccess(workspaceId, projectId, actor);
    const existing = await this.find(workspaceId, actor.userId, projectId);
    if (existing) return this.toDto(existing);
    const row = await this.prisma.calendarFeed.create({
      data: { workspaceId, userId: actor.userId, projectId, token: newToken() },
    });
    return this.toDto(row);
  }

  /** A new link in place of the old, which stops working at once. */
  async reset(
    workspaceId: string,
    actor: ActorContext,
    projectId: string | null,
  ): Promise<CalendarFeed> {
    if (projectId) await this.access.resolveAccess(workspaceId, projectId, actor);
    const existing = await this.find(workspaceId, actor.userId, projectId);
    const row = existing
      ? await this.prisma.calendarFeed.update({
          where: { id: existing.id },
          data: { token: newToken(), lastFetchedAt: null },
        })
      : await this.prisma.calendarFeed.create({
          data: { workspaceId, userId: actor.userId, projectId, token: newToken() },
        });
    return this.toDto(row);
  }

  async remove(workspaceId: string, actor: ActorContext, projectId: string | null): Promise<void> {
    await this.prisma.calendarFeed.deleteMany({
      where: { workspaceId, userId: actor.userId, projectId },
    });
  }

  /** The calendar behind a link, as its owner may see it right now. */
  async render(token: string): Promise<string> {
    const feed = await this.prisma.calendarFeed.findUnique({ where: { token } });
    if (!feed) throw notFound();
    const member = await this.prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: feed.workspaceId, userId: feed.userId } },
      select: { role: true },
    });
    if (!member) throw notFound();
    const actor: ActorContext = { userId: feed.userId, role: member.role as WorkspaceRole };

    let scope: Prisma.TaskWhereInput;
    let name: string;
    if (feed.projectId) {
      const access = await this.access.findAccess(feed.workspaceId, feed.projectId, actor);
      if (!access) throw notFound();
      const project = await this.prisma.project.findUniqueOrThrow({
        where: { id: feed.projectId },
        select: { name: true },
      });
      // A project's tasks include those linked in from elsewhere.
      scope = {
        OR: [
          { projectId: feed.projectId },
          { projectLinks: { some: { projectId: feed.projectId } } },
        ],
      };
      name = `CoreTask · ${project.name}`;
    } else {
      scope = { AND: [this.access.taskWhere(actor)], assigneeId: actor.userId };
      name = 'CoreTask · My Tasks';
    }

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - LOOKBACK_DAYS);
    since.setUTCHours(0, 0, 0, 0);
    const tasks = await this.prisma.task.findMany({
      where: {
        workspaceId: feed.workspaceId,
        archivedAt: null,
        completedAt: null,
        AND: [scope, { OR: [{ dueDate: { gte: since } }, { dueAt: { gte: since } }] }],
      },
      select: {
        id: true,
        title: true,
        startDate: true,
        startAt: true,
        dueDate: true,
        dueAt: true,
        updatedAt: true,
        project: { select: { name: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { dueAt: 'asc' }, { id: 'asc' }],
      take: MAX_EVENTS,
    });

    const now = new Date();
    if (!feed.lastFetchedAt || now.getTime() - feed.lastFetchedAt.getTime() > FETCH_STAMP_MS) {
      await this.prisma.calendarFeed.update({
        where: { id: feed.id },
        data: { lastFetchedAt: now },
      });
    }

    const webUrl = this.webUrl();
    const events: IcsEvent[] = [];
    for (const task of tasks) {
      const when = whenOf(task);
      if (!when) continue;
      events.push({
        uid: `${task.id}@coretask`,
        title: task.title,
        when,
        description: task.project ? `In ${task.project.name}` : undefined,
        url: `${webUrl}/my-tasks?task=${task.id}`,
        updatedAt: task.updatedAt,
      });
    }
    return buildCalendar(name, events, now);
  }

  private find(workspaceId: string, userId: string, projectId: string | null) {
    return this.prisma.calendarFeed.findFirst({ where: { workspaceId, userId, projectId } });
  }

  private toDto(row: FeedRow): CalendarFeed {
    const apiUrl = this.config.http.apiUrl.replace(/\/$/, '');
    return {
      id: row.id,
      projectId: row.projectId,
      url: `${apiUrl}${API_PREFIX}${ApiRoutes.calendarFeeds.feed(row.token)}`,
      lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** The first of WEB_URL's origins: the one people open. */
  private webUrl(): string {
    return (this.config.http.webUrl.split(',')[0] ?? '').trim().replace(/\/$/, '');
  }
}

function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function notFound() {
  return AppException.notFound('RESOURCE_NOT_FOUND', 'Calendar not found.');
}

const dayOf = (value: Date) => value.toISOString().slice(0, 10);

/**
 * When a task happens on a calendar: from its start to its due date, all day;
 * or, with a due time, from its start time (or a short block before) to then.
 */
export function whenOf(task: {
  startDate: Date | null;
  startAt: Date | null;
  dueDate: Date | null;
  dueAt: Date | null;
}): IcsWhen | null {
  if (task.dueAt) {
    const start =
      task.startAt && task.startAt < task.dueAt
        ? task.startAt
        : new Date(task.dueAt.getTime() - TIMED_MINUTES * 60_000);
    return { kind: 'time', start, end: task.dueAt };
  }
  if (!task.dueDate) return null;
  const end = dayOf(task.dueDate);
  const start = task.startDate && dayOf(task.startDate) < end ? dayOf(task.startDate) : end;
  return { kind: 'day', start, end };
}
