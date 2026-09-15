import { WorkspaceRole } from '@coretask/contracts';
import type { Follower } from '@coretask/types';
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
import { TasksService } from '../tasks/tasks.service';
import { TicketsService } from '../tickets/tickets.service';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AddFollowersDto } from './dto/follower.dto';
import { FollowerDto } from './dto/follower-response.dto';
import { FollowersService } from './followers.service';
import { taskLink, taskRef, ticketLink, ticketRef } from './item-ref';

/**
 * Collaborators hang off the item, like its thread does. The parent is
 * resolved inside the workspace first — and through the caller's view of its
 * project — so nobody can read or change who follows a task in another
 * tenant, or in a private project they are not part of.
 */
@ApiTags('Followers')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tasks/:taskId/followers')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'taskId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
@ApiErrorResponseDoc(
  404,
  'No such task in this workspace, or it is in a private project the caller is not in',
)
export class TaskFollowersController {
  constructor(
    private readonly followers: FollowersService,
    private readonly tasks: TasksService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Who follows a task', description: 'In the order they joined.' })
  @ApiEnvelopeResponse(FollowerDto, { isArray: true })
  async list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<Follower[]> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor);
    return this.followers.list(workspaceId, taskLink(task.id));
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Add collaborators to a task',
    description:
      'Workspace members who can see the task’s project only. Adding someone already following is a no-op.',
  })
  @ApiEnvelopeResponse(FollowerDto, { isArray: true, status: 201 })
  @ApiErrorResponseDoc(400, 'Somebody named is not a member here, or cannot see this project')
  @ApiErrorResponseDoc(422, 'Validation failed')
  async add(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
    @Body() dto: AddFollowersDto,
  ): Promise<Follower[]> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor, WorkspaceRole.MEMBER);
    return this.followers.add(taskRef(workspaceId, task), actor.userId, dto.userIds);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOperation({
    summary: 'Leave a task, or remove a collaborator',
    description:
      'Anyone may remove themselves; MANAGER and above (in the project) may remove anyone.',
  })
  @ApiEnvelopeResponse(FollowerDto, { isArray: true })
  @ApiErrorResponseDoc(403, 'Removing someone else needs MANAGER')
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Actor() actor: ActorContext,
  ): Promise<Follower[]> {
    const task = await this.tasks.requireTask(workspaceId, taskId, actor);
    return this.followers.remove(taskRef(workspaceId, task), actor, userId);
  }
}

@ApiTags('Followers')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tickets/:idOrKey/followers')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'idOrKey', example: 'CORE-1001' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
@ApiErrorResponseDoc(
  404,
  'No such ticket in this workspace, or it is in a private project the caller is not in',
)
export class TicketFollowersController {
  constructor(
    private readonly followers: FollowersService,
    private readonly tickets: TicketsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Who follows a ticket',
    description: 'The ticket may be addressed by UUID or by key.',
  })
  @ApiEnvelopeResponse(FollowerDto, { isArray: true })
  async list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('idOrKey') idOrKey: string,
    @Actor() actor: ActorContext,
  ): Promise<Follower[]> {
    const ticket = await this.tickets.requireTicket(workspaceId, idOrKey, actor);
    return this.followers.list(workspaceId, ticketLink(ticket.id));
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({ summary: 'Add collaborators to a ticket' })
  @ApiEnvelopeResponse(FollowerDto, { isArray: true, status: 201 })
  @ApiErrorResponseDoc(400, 'Somebody named is not a member here, or cannot see this project')
  @ApiErrorResponseDoc(422, 'Validation failed')
  async add(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('idOrKey') idOrKey: string,
    @Actor() actor: ActorContext,
    @Body() dto: AddFollowersDto,
  ): Promise<Follower[]> {
    const ticket = await this.tickets.requireTicket(
      workspaceId,
      idOrKey,
      actor,
      WorkspaceRole.MEMBER,
    );
    return this.followers.add(ticketRef(workspaceId, ticket), actor.userId, dto.userIds);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiOperation({ summary: 'Leave a ticket, or remove a collaborator' })
  @ApiEnvelopeResponse(FollowerDto, { isArray: true })
  @ApiErrorResponseDoc(403, 'Removing someone else needs MANAGER')
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('idOrKey') idOrKey: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Actor() actor: ActorContext,
  ): Promise<Follower[]> {
    const ticket = await this.tickets.requireTicket(workspaceId, idOrKey, actor);
    return this.followers.remove(ticketRef(workspaceId, ticket), actor, userId);
  }
}
