import { WorkspaceRole } from '@coretask/contracts';
import type { Team, TeamDetail } from '@coretask/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CurrentWorkspace,
  RequireWorkspaceRole,
} from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { TeamDetailDto, TeamDto } from './dto/team-response.dto';
import { AddTeamMemberDto, CreateTeamDto, UpdateTeamDto } from './dto/team.dto';
import { TeamsService } from './teams.service';

/**
 * Teams are visible to every workspace member — you cannot pick the right team
 * for a project if you cannot see the list.
 *
 * Creating and deleting are workspace administration and use the role decorator.
 * Editing a team and changing its roster are not: they are open to ADMIN *or*
 * the team's own lead, and a decorator cannot express "or the lead" because it
 * does not know which team is being addressed. Those checks live in the service.
 */
@ApiTags('Teams')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/teams')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @ApiOperation({ summary: 'List the workspace’s teams' })
  @ApiEnvelopeResponse(TeamDto, { isArray: true })
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<Team[]> {
    return this.teams.list(workspaceId);
  }

  @Get(':teamId')
  @ApiOperation({ summary: 'Read one team with its roster' })
  @ApiParam({ name: 'teamId', format: 'uuid' })
  @ApiEnvelopeResponse(TeamDetailDto)
  @ApiErrorResponseDoc(404, 'No such team in this workspace')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ): Promise<TeamDetail> {
    return this.teams.get(workspaceId, teamId);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Create a team',
    description:
      'Requires ADMIN. Names are unique within the workspace, and a lead named here must already be a workspace member.',
  })
  @ApiEnvelopeResponse(TeamDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'The nominated lead is not a member, or the team limit is reached')
  @ApiErrorResponseDoc(409, 'A team with that name already exists')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTeamDto,
  ): Promise<Team> {
    return this.teams.create(workspaceId, userId, dto);
  }

  @Patch(':teamId')
  @ApiOperation({
    summary: 'Rename a team, recolour it, or change its lead',
    description: 'Open to ADMIN and above, or to the team’s current lead.',
  })
  @ApiParam({ name: 'teamId', format: 'uuid' })
  @ApiEnvelopeResponse(TeamDto)
  @ApiErrorResponseDoc(400, 'No fields supplied, or the nominated lead is not a member')
  @ApiErrorResponseDoc(403, 'Not an administrator and not the team lead')
  @ApiErrorResponseDoc(404, 'No such team in this workspace')
  @ApiErrorResponseDoc(409, 'A team with that name already exists')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdateTeamDto,
  ): Promise<Team> {
    return this.teams.update(workspaceId, userId, role, teamId, dto);
  }

  @Delete(':teamId')
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a team',
    description:
      'Requires ADMIN — a lead may run their team but not dissolve it. Projects assigned to the team survive, unassigned.',
  })
  @ApiParam({ name: 'teamId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'No such team in this workspace')
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.teams.remove(workspaceId, userId, teamId);
  }

  @Post(':teamId/members')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Add a workspace member to the team',
    description:
      'Open to ADMIN and above, or to the team’s lead. Adding someone twice is not an error.',
  })
  @ApiParam({ name: 'teamId', format: 'uuid' })
  @ApiEnvelopeResponse(TeamDetailDto)
  @ApiErrorResponseDoc(400, 'That person is not a member of this workspace')
  @ApiErrorResponseDoc(403, 'Not an administrator and not the team lead')
  @ApiErrorResponseDoc(404, 'No such team in this workspace')
  addMember(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: AddTeamMemberDto,
  ): Promise<TeamDetail> {
    return this.teams.addMember(workspaceId, userId, role, teamId, dto.userId);
  }

  @Delete(':teamId/members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove someone from the team',
    description:
      'Open to ADMIN and above, or to the team’s lead. Removing the lead also stands the appointment down.',
  })
  @ApiParam({ name: 'teamId', format: 'uuid' })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiEnvelopeResponse(TeamDetailDto)
  @ApiErrorResponseDoc(403, 'Not an administrator and not the team lead')
  @ApiErrorResponseDoc(404, 'No such team in this workspace')
  removeMember(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('userId', ParseUUIDPipe) memberUserId: string,
    @CurrentUser('id') actorId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<TeamDetail> {
    return this.teams.removeMember(workspaceId, actorId, role, teamId, memberUserId);
  }
}
