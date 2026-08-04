import {
  ActivityAction,
  ActivityEntity,
  MAX_TEAMS_PER_WORKSPACE,
  WorkspaceRole,
  hasAtLeastRole,
} from '@coretask/contracts';
import type { Team, TeamDetail } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, Team as PrismaTeam } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { WorkspaceMembersService } from '../workspace-members/workspace-members.service';

import type { CreateTeamDto, UpdateTeamDto } from './dto/team.dto';

const USER_SELECT = { id: true, name: true, email: true, avatarUrl: true } as const;

const teamInclude = {
  lead: { select: USER_SELECT },
  _count: { select: { members: true, projects: true } },
} satisfies Prisma.TeamInclude;

type TeamWithCounts = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly members: WorkspaceMembersService,
    private readonly activity: ActivityLogsService,
  ) {}

  async list(workspaceId: string): Promise<Team[]> {
    const teams = await this.prisma.team.findMany({
      where: { workspaceId },
      include: teamInclude,
      orderBy: { name: 'asc' },
    });

    return teams.map(toTeamDto);
  }

  async get(workspaceId: string, teamId: string): Promise<TeamDetail> {
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, workspaceId },
      include: { ...teamInclude, members: { include: { user: { select: USER_SELECT } } } },
    });

    if (!team) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Team not found.');
    }

    return {
      ...toTeamDto(team),
      members: team.members.map((member) => member.user),
    };
  }

  async create(workspaceId: string, actorId: string, dto: CreateTeamDto): Promise<Team> {
    await this.assertCapacity(workspaceId);
    if (dto.leadId) await this.assertWorkspaceMember(workspaceId, dto.leadId);

    const team = await this.prisma
      .$transaction(async (tx) => {
        const created = await tx.team.create({
          data: {
            workspaceId,
            name: dto.name,
            description: dto.description ?? null,
            ...(dto.color ? { color: dto.color } : {}),
            leadId: dto.leadId ?? null,
          },
        });

        // A lead who is not in their own team is a strange thing to have to fix
        // by hand, so membership comes with the appointment.
        if (dto.leadId) {
          await tx.teamMember.create({ data: { teamId: created.id, userId: dto.leadId } });
        }

        return created;
      })
      .catch(rethrowDuplicateName);

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.TEAM,
      entityId: team.id,
      summary: `Created the team "${team.name}"`,
    });

    this.logger.log({ workspaceId, teamId: team.id }, 'Team created');

    return this.read(team.id);
  }

  async update(
    workspaceId: string,
    actorId: string,
    actorRole: WorkspaceRole,
    teamId: string,
    dto: UpdateTeamDto,
  ): Promise<Team> {
    const team = await this.requireTeam(workspaceId, teamId);
    this.assertCanManage(actorId, actorRole, team);

    if (dto.leadId) await this.assertWorkspaceMember(workspaceId, dto.leadId);

    const data: Prisma.TeamUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.leadId !== undefined) {
      data.lead = dto.leadId ? { connect: { id: dto.leadId } } : { disconnect: true };
    }

    if (Object.keys(data).length === 0) {
      throw AppException.badRequest('BAD_REQUEST', 'Provide at least one field to update.');
    }

    await this.prisma
      .$transaction(async (tx) => {
        await tx.team.update({ where: { id: teamId }, data });

        // Same reasoning as on create: appointing a lead puts them in the team.
        if (dto.leadId) {
          await tx.teamMember.upsert({
            where: { teamId_userId: { teamId, userId: dto.leadId } },
            create: { teamId, userId: dto.leadId },
            update: {},
          });
        }
      })
      .catch(rethrowDuplicateName);

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.TEAM,
      entityId: teamId,
      summary: `Updated the team "${dto.name ?? team.name}"`,
      metadata: { fields: Object.keys(data) },
    });

    return this.read(teamId);
  }

  /**
   * Deletes a team outright rather than archiving it.
   *
   * A team is an organisational grouping, not a record of work: nothing is lost
   * by removing one. Its projects survive with `teamId` set to null — losing a
   * team must never take projects with it — and the membership rows go.
   */
  async remove(workspaceId: string, actorId: string, teamId: string): Promise<void> {
    const team = await this.requireTeam(workspaceId, teamId);

    await this.prisma.team.delete({ where: { id: teamId } });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.DELETED,
      entity: ActivityEntity.TEAM,
      entityId: teamId,
      summary: `Deleted the team "${team.name}"`,
    });

    this.logger.log({ workspaceId, teamId }, 'Team deleted');
  }

  /**
   * Adds a workspace member to a team.
   *
   * The workspace-membership check is the one that matters: a team is always a
   * subset of the workspace, so without it a team could quietly carry people who
   * have no access to anything it works on.
   */
  async addMember(
    workspaceId: string,
    actorId: string,
    actorRole: WorkspaceRole,
    teamId: string,
    userId: string,
  ): Promise<TeamDetail> {
    const team = await this.requireTeam(workspaceId, teamId);
    this.assertCanManage(actorId, actorRole, team);
    await this.assertWorkspaceMember(workspaceId, userId);

    await this.prisma.teamMember.upsert({
      where: { teamId_userId: { teamId, userId } },
      create: { teamId, userId },
      // Adding someone twice is the same as adding them once, not an error.
      update: {},
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.MEMBER_ADDED,
      entity: ActivityEntity.TEAM,
      entityId: teamId,
      summary: `Added someone to the team "${team.name}"`,
      metadata: { userId },
    });

    return this.get(workspaceId, teamId);
  }

  async removeMember(
    workspaceId: string,
    actorId: string,
    actorRole: WorkspaceRole,
    teamId: string,
    userId: string,
  ): Promise<TeamDetail> {
    const team = await this.requireTeam(workspaceId, teamId);
    this.assertCanManage(actorId, actorRole, team);

    await this.prisma.$transaction(async (tx) => {
      await tx.teamMember.deleteMany({ where: { teamId, userId } });

      // A lead who is no longer in the team is not leading it. Clearing the
      // appointment keeps the two from disagreeing.
      if (team.leadId === userId) {
        await tx.team.update({ where: { id: teamId }, data: { leadId: null } });
      }
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.MEMBER_REMOVED,
      entity: ActivityEntity.TEAM,
      entityId: teamId,
      summary: `Removed someone from the team "${team.name}"`,
      metadata: { userId },
    });

    return this.get(workspaceId, teamId);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Editing a team is open to workspace administrators *or* the team's own lead.
   *
   * That is the whole point of appointing one: someone who runs the team without
   * needing workspace-wide powers to do it.
   */
  private assertCanManage(actorId: string, actorRole: WorkspaceRole, team: PrismaTeam): void {
    if (hasAtLeastRole(actorRole, WorkspaceRole.ADMIN)) return;
    if (team.leadId === actorId) return;

    throw AppException.forbidden(
      'FORBIDDEN',
      'Only a workspace administrator or the team lead can change this team.',
    );
  }

  private async assertWorkspaceMember(workspaceId: string, userId: string): Promise<void> {
    const membership = await this.members.findMembership(workspaceId, userId);

    if (!membership) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'That person is not a member of this workspace.',
      );
    }
  }

  private async assertCapacity(workspaceId: string): Promise<void> {
    const count = await this.prisma.team.count({ where: { workspaceId } });

    if (count >= MAX_TEAMS_PER_WORKSPACE) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'This workspace already has the maximum number of teams.',
      );
    }
  }

  private async requireTeam(workspaceId: string, teamId: string): Promise<PrismaTeam> {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, workspaceId } });

    if (!team) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Team not found.');
    }

    return team;
  }

  private async read(teamId: string): Promise<Team> {
    const team = await this.prisma.team.findUniqueOrThrow({
      where: { id: teamId },
      include: teamInclude,
    });

    return toTeamDto(team);
  }
}

/** Turns the unique-name constraint into an explanation rather than a 500. */
function rethrowDuplicateName(error: unknown): never {
  const code = (error as { code?: string }).code;

  if (code === 'P2002') {
    throw AppException.conflict('RESOURCE_CONFLICT', 'A team with that name already exists.');
  }

  throw error;
}

function toTeamDto(team: TeamWithCounts): Team {
  return {
    id: team.id,
    workspaceId: team.workspaceId,
    name: team.name,
    description: team.description,
    color: team.color,
    lead: team.lead,
    leadId: team.leadId,
    memberCount: team._count.members,
    projectCount: team._count.projects,
    createdAt: team.createdAt.toISOString(),
    updatedAt: team.updatedAt.toISOString(),
  };
}
