import { GOAL_STATUSES, type GoalStatus } from '@coretask/contracts';
import type { GoalUpdate } from '@coretask/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { GoalUpdatesService } from './goal-updates.service';

export class PostGoalUpdateDto {
  @ApiProperty({ enum: GOAL_STATUSES })
  @IsIn(GOAL_STATUSES)
  status!: GoalStatus;

  @ApiPropertyOptional({ description: 'Rich text: how it is going, and why.' })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  body?: string;
}

@ApiTags('Goals')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/goals/:goalId/updates')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'goalId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'No such goal in this workspace')
export class GoalUpdatesController {
  constructor(private readonly updates: GoalUpdatesService) {}

  @Get()
  @ApiOperation({ summary: "A goal's status updates, newest first" })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Actor() actor: ActorContext,
  ): Promise<GoalUpdate[]> {
    return this.updates.list(workspaceId, actor, goalId);
  }

  @Post()
  @ApiOperation({ summary: 'Post a status update', description: "Sets the goal's status." })
  post(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Actor() actor: ActorContext,
    @Body() dto: PostGoalUpdateDto,
  ): Promise<GoalUpdate> {
    return this.updates.post(workspaceId, actor, goalId, dto);
  }

  @Delete(':updateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'updateId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a status update (its author, or a manager)' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Param('updateId', ParseUUIDPipe) updateId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.updates.remove(workspaceId, actor, goalId, updateId);
  }
}
