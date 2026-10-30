import type {
  SearchKind,
  SearchPersonHit,
  SearchProjectHit,
  SearchResults,
  SearchTaskHit,
  SearchTicketHit,
} from '@coretask/types';
import { Injectable } from '@nestjs/common';

import type { ActorContext } from '../../common/types/api.types';
import { PrismaService } from '../../database/prisma.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import { SEARCH_KINDS } from './dto/search.dto';
import { rankHits } from './search-rank';

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;
const PROJECT_SELECT = { id: true, name: true, color: true } as const;

/**
 * How many candidates to fetch per kind for each hit returned.
 *
 * The database orders by recency, not relevance, so a page of exactly `limit`
 * rows can miss the exact match that was last touched a month ago. Fetching a
 * few times more and ranking here is the cheap middle ground between that and
 * a full-text index.
 */
const CANDIDATE_FACTOR = 4;

/** `CORE-1042`: a ticket key, which deserves an exact lookup. */
const TICKET_KEY = /^[a-z][a-z0-9]{0,15}-\d+$/i;

/**
 * The top-bar search, across everything a workspace holds.
 *
 * Archived work is left out, as Asana leaves deleted tasks out of its default
 * search: the box answers "where is the thing I'm working on", and a result
 * that opens onto an archived record is a dead end.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ProjectAccessService,
  ) {}

  async search(
    workspaceId: string,
    actor: ActorContext,
    query: string,
    kinds: readonly SearchKind[] = SEARCH_KINDS,
    limit: number,
  ): Promise<SearchResults> {
    const term = query.trim();
    const take = limit * CANDIDATE_FACTOR;
    const wants = (kind: SearchKind) => kinds.includes(kind);

    const [tasks, tickets, projects, people] = await Promise.all([
      wants('tasks') ? this.tasks(workspaceId, actor, term, take) : [],
      wants('tickets') ? this.tickets(workspaceId, actor, term, take) : [],
      wants('projects') ? this.projects(workspaceId, actor, term, take) : [],
      wants('people') ? this.people(workspaceId, term, take) : [],
    ]);

    return {
      query: term,
      tasks: rankHits(tasks, term, (hit) => [hit.title], limit),
      tickets: rankHits(tickets, term, (hit) => [hit.key, hit.title], limit),
      projects: rankHits(projects, term, (hit) => [hit.name, hit.key], limit),
      people: rankHits(people, term, (hit) => [hit.name, hit.email], limit),
    };
  }

  private async tasks(
    workspaceId: string,
    actor: ActorContext,
    term: string,
    take: number,
  ): Promise<SearchTaskHit[]> {
    const rows = await this.prisma.task.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        title: { contains: term, mode: 'insensitive' },
        AND: [
          // A task in an archived project is as unreachable as an archived task.
          { OR: [{ projectId: null }, { project: { archivedAt: null } }] },
          // And one in a private project the reader is not on does not exist
          // for them — the same scope every task list applies, which a project
          // it is linked into can open.
          this.access.taskWhere(actor),
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take,
      select: {
        id: true,
        title: true,
        completedAt: true,
        dueDate: true,
        assignee: { select: USER_SELECT },
        project: { select: PROJECT_SELECT },
        parentTask: { select: { id: true, title: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      isCompleted: row.completedAt !== null,
      dueDate: row.dueDate?.toISOString() ?? null,
      assignee: row.assignee,
      project: row.project,
      parent: row.parentTask,
    }));
  }

  private async tickets(
    workspaceId: string,
    actor: ActorContext,
    term: string,
    take: number,
  ): Promise<SearchTicketHit[]> {
    const rows = await this.prisma.ticket.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        AND: [this.access.scopedWhere(actor)],
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          // A pasted key matches exactly, and only then — "CORE-1" must not
          // also bring back CORE-10 through CORE-19.
          ...(TICKET_KEY.test(term) ? [{ key: { equals: term.toUpperCase() } }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take,
      select: {
        id: true,
        key: true,
        title: true,
        status: true,
        project: { select: PROJECT_SELECT },
      },
    });

    return rows;
  }

  private async projects(
    workspaceId: string,
    actor: ActorContext,
    term: string,
    take: number,
  ): Promise<SearchProjectHit[]> {
    return this.prisma.project.findMany({
      where: {
        workspaceId,
        archivedAt: null,
        AND: [this.access.projectWhere(actor)],
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { key: { equals: term.toUpperCase() } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take,
      select: { id: true, name: true, key: true, color: true, status: true },
    });
  }

  private async people(
    workspaceId: string,
    term: string,
    take: number,
  ): Promise<SearchPersonHit[]> {
    const members = await this.prisma.workspaceMember.findMany({
      where: {
        workspaceId,
        deactivatedAt: null,
        user: {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
          ],
        },
      },
      orderBy: { joinedAt: 'asc' },
      take,
      select: { role: true, user: { select: USER_SELECT } },
    });

    return members.map((member) => ({ ...member.user, role: member.role }));
  }
}
