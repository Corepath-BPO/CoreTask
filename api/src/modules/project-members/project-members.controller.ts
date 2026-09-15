import type { ProjectMember } from '@coretask/types';
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
import {
  Actor,
  CurrentProject,
  RequireProjectAdmin,
} from '../../common/decorators/workspace.decorator';
import type { ActorContext, ProjectAccessContext } from '../../common/types/api.types';
import { ProjectAccessGuard } from '../project-access/project-access.guard';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  LeaveProjectResultDto,
  ProjectMemberDto,
  RemoveProjectMemberResultDto,
} from './dto/project-member-response.dto';
import { AddProjectMemberDto, UpdateProjectMemberRoleDto } from './dto/project-member.dto';
import { ProjectMembersService } from './project-members.service';

/**
 * A project's roster, and the self-service `join` / `leave` beside it.
 *
 * Mounted at the project rather than at `.../members` so `join` and `leave`
 * sit next to the list they change. `ProjectAccessGuard` hides a private
 * project from non-members and settles who may manage the roster;
 * `@RequireProjectAdmin()` is the whole authorisation for the writes, so a
 * project admin manages their project whatever their workspace role.
 */
@ApiTags('Project members')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId')
@UseGuards(WorkspaceMemberGuard, ProjectAccessGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member of this workspace, or not a project admin for a change')
@ApiErrorResponseDoc(404, 'No such project here, or it is private and the caller is not a member')
export class ProjectMembersController {
  constructor(private readonly members: ProjectMembersService) {}

  /*
   * Declared before `members/:userId` so neither word is ever read as an id.
   */
  @Post('join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Join a public project',
    description:
      'Adds the caller as an editor (a guest joins as a viewer). Joining twice is not an error. A private project cannot be joined; ask one of its admins.',
  })
  @ApiEnvelopeResponse(ProjectMemberDto)
  @ApiErrorResponseDoc(403, 'The project is private')
  join(
    @CurrentProject() access: ProjectAccessContext,
    @Actor() actor: ActorContext,
  ): Promise<ProjectMember> {
    return this.members.join(access, actor);
  }

  @Post('leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Leave a project',
    description:
      'Removes the caller from the roster. The last admin of a private project cannot leave until someone else is made an admin.',
  })
  @ApiEnvelopeResponse(LeaveProjectResultDto)
  @ApiErrorResponseDoc(409, 'The caller is the last admin of a private project')
  async leave(
    @CurrentProject() access: ProjectAccessContext,
    @Actor() actor: ActorContext,
  ): Promise<{ left: boolean }> {
    const { removed } = await this.members.remove(access, actor, actor.userId);
    return { left: removed };
  }

  @Get('members')
  @ApiOperation({
    summary: 'List a project’s members',
    description: 'Admins first, then in the order they were added.',
  })
  @ApiEnvelopeResponse(ProjectMemberDto, { isArray: true })
  list(@CurrentProject('projectId') projectId: string): Promise<ProjectMember[]> {
    return this.members.list(projectId);
  }

  @Post('members')
  @RequireProjectAdmin()
  @ApiOperation({
    summary: 'Add a workspace member to the project',
    description:
      'Project admins and workspace admins. Adding someone already on the roster leaves their role alone; use PATCH to change it.',
  })
  @ApiEnvelopeResponse(ProjectMemberDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'That person is not a member of this workspace')
  @ApiErrorResponseDoc(422, 'Validation failed')
  add(
    @CurrentProject() access: ProjectAccessContext,
    @Actor() actor: ActorContext,
    @Body() dto: AddProjectMemberDto,
  ): Promise<ProjectMember> {
    return this.members.add(access, actor, dto.userId, dto.role);
  }

  @Patch('members/:userId')
  @RequireProjectAdmin()
  @ApiOperation({
    summary: 'Change a member’s role in the project',
    description:
      'Project admins and workspace admins. A private project keeps at least one admin, so demoting the last one is refused.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectMemberDto)
  @ApiErrorResponseDoc(404, 'Not a member of this project')
  @ApiErrorResponseDoc(409, 'They are the last admin of a private project')
  @ApiErrorResponseDoc(422, 'Validation failed')
  updateRole(
    @CurrentProject() access: ProjectAccessContext,
    @Actor() actor: ActorContext,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateProjectMemberRoleDto,
  ): Promise<ProjectMember> {
    return this.members.updateRole(access, actor, userId, dto.role);
  }

  @Delete('members/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove someone from the project, or leave it',
    description:
      'Anyone may remove themselves; project admins and workspace admins may remove anyone. The last admin of a private project stays until someone else is made an admin. Removing the lead also stands the appointment down.',
  })
  @ApiParam({ name: 'userId', format: 'uuid' })
  @ApiEnvelopeResponse(RemoveProjectMemberResultDto)
  @ApiErrorResponseDoc(403, 'Removing someone else needs a project admin')
  @ApiErrorResponseDoc(409, 'They are the last admin of a private project')
  remove(
    @CurrentProject() access: ProjectAccessContext,
    @Actor() actor: ActorContext,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ removed: boolean }> {
    return this.members.remove(access, actor, userId);
  }
}
