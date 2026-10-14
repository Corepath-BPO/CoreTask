import { WorkspaceRole } from '@coretask/contracts';
import type { Goal } from '@coretask/types';
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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { Actor, RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { CreateGoalDto, GoalDto, UpdateGoalDto } from './dto/goal.dto';
import { GoalsService } from './goals.service';

@ApiTags('Goals')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/goals')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get()
  @ApiOperation({
    summary: 'The workspace’s goals',
    description: 'Flat, in order; `parentId` builds the tree. Progress is rolled up on read.',
  })
  @ApiEnvelopeResponse(GoalDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<Goal[]> {
    return this.goals.list(workspaceId, actor);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Create a goal',
    description: 'The creator owns it unless told otherwise.',
  })
  @ApiEnvelopeResponse(GoalDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'Unknown owner, team or parent goal')
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateGoalDto,
  ): Promise<Goal> {
    return this.goals.create(workspaceId, actor, dto);
  }

  @Patch(':goalId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiParam({ name: 'goalId', format: 'uuid' })
  @ApiOperation({ summary: 'Update a goal' })
  @ApiEnvelopeResponse(GoalDto)
  @ApiErrorResponseDoc(400, 'A parent that would loop, or an unknown owner or team')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateGoalDto,
  ): Promise<Goal> {
    return this.goals.update(workspaceId, actor, goalId, dto);
  }

  @Delete(':goalId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'goalId', format: 'uuid' })
  @ApiOperation({
    summary: 'Delete a goal',
    description:
      'Archives it; its sub-goals move up to its parent. Owner, creator or MANAGER and above.',
  })
  @ApiErrorResponseDoc(403, 'Not the owner, the creator or a manager')
  async archive(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    await this.goals.archive(workspaceId, actor, goalId);
  }

  @Put(':goalId/projects/:projectId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'goalId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'Connect a project to a goal' })
  @ApiEnvelopeResponse(GoalDto)
  @ApiErrorResponseDoc(404, 'No such goal or project, or the project is private to the caller')
  linkProject(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<Goal> {
    return this.goals.linkProject(workspaceId, actor, goalId, projectId);
  }

  @Delete(':goalId/projects/:projectId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'goalId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'Disconnect a project from a goal' })
  @ApiEnvelopeResponse(GoalDto)
  unlinkProject(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<Goal> {
    return this.goals.unlinkProject(workspaceId, actor, goalId, projectId);
  }
}
