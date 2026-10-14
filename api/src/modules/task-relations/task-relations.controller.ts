import { WorkspaceRole } from '@coretask/contracts';
import type { TaskDependencies, TaskLikes } from '@coretask/types';
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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { Actor, RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AddDependencyDto, TaskDependenciesDto, TaskLikesDto } from './dto/task-relations.dto';
import { TaskRelationsService } from './task-relations.service';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tasks/:taskId')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'taskId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
@ApiErrorResponseDoc(
  404,
  'No such task in this workspace, or it is in a private project the caller is not in',
)
export class TaskRelationsController {
  constructor(private readonly relations: TaskRelationsService) {}

  @Get('likes')
  @ApiOperation({ summary: 'Who has liked a task' })
  @ApiEnvelopeResponse(TaskLikesDto)
  likes(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskLikes> {
    return this.relations.likes(workspaceId, taskId, actor);
  }

  @Post('likes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Like a task',
    description: 'Anyone who can see the task. Liking twice is the same as liking once.',
  })
  @ApiEnvelopeResponse(TaskLikesDto)
  like(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskLikes> {
    return this.relations.like(workspaceId, taskId, actor);
  }

  @Delete('likes')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take back your like' })
  @ApiEnvelopeResponse(TaskLikesDto)
  unlike(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskLikes> {
    return this.relations.unlike(workspaceId, taskId, actor);
  }

  @Get('dependencies')
  @ApiOperation({
    summary: 'What a task waits on, and what waits on it',
    description: 'Ends in private projects the caller cannot see are left out.',
  })
  @ApiEnvelopeResponse(TaskDependenciesDto)
  dependencies(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskDependencies> {
    return this.relations.dependencies(workspaceId, taskId, actor);
  }

  @Post('dependencies')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Add a dependency',
    description:
      'Refused when it would make a loop of tasks each waiting on the next, or past the per-task cap. Adding one that exists is a no-op.',
  })
  @ApiEnvelopeResponse(TaskDependenciesDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'Self-dependency, a loop, or too many dependencies')
  @ApiErrorResponseDoc(422, 'Validation failed')
  addDependency(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
    @Body() dto: AddDependencyDto,
  ): Promise<TaskDependencies> {
    return this.relations.addDependency(workspaceId, taskId, actor, dto.taskId, dto.direction);
  }

  @Delete('dependencies/:dependencyId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'dependencyId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a dependency, from either end' })
  @ApiEnvelopeResponse(TaskDependenciesDto)
  removeDependency(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('dependencyId', ParseUUIDPipe) dependencyId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskDependencies> {
    return this.relations.removeDependency(workspaceId, taskId, actor, dependencyId);
  }
}
