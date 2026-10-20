import type {
  ProjectMember,
  ProjectNotificationSettings,
  WorkspaceInvitation,
} from '@coretask/types';
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
import {
  Actor,
  CurrentProject,
  RequireProjectAdmin,
} from '../../common/decorators/workspace.decorator';
import type { ActorContext, ProjectAccessContext } from '../../common/types/api.types';
import { WorkspaceInvitationDto } from '../invitations/dto/invitation-response.dto';
import { InvitationsService } from '../invitations/invitations.service';
import { ProjectAccessGuard } from '../project-access/project-access.guard';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  LeaveProjectResultDto,
  ProjectMemberDto,
  ProjectNotificationSettingsDto,
  RemoveProjectMemberResultDto,
} from './dto/project-member-response.dto';
import {
  AddProjectMemberDto,
  InviteToProjectDto,
  UpdateProjectMemberRoleDto,
  UpdateProjectNotificationSettingsDto,
} from './dto/project-member.dto';
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
  constructor(
    private readonly members: ProjectMembersService,
    private readonly invitations: InvitationsService,
  ) {}

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

  @Get('notification-settings')
  @ApiOperation({
    summary: 'What this project tells you about',
    description:
      'Status updates and messages until you choose. Only members hear from a project; for anyone else `member` is false and `notifyOn` is what joining starts with.',
  })
  @ApiEnvelopeResponse(ProjectNotificationSettingsDto)
  notificationSettings(
    @CurrentProject() access: ProjectAccessContext,
    @Actor() actor: ActorContext,
  ): Promise<ProjectNotificationSettings> {
    return this.members.notificationSettings(access, actor);
  }

  @Put('notification-settings')
  @ApiOperation({ summary: 'Choose what this project tells you about' })
  @ApiEnvelopeResponse(ProjectNotificationSettingsDto)
  @ApiErrorResponseDoc(409, 'The caller is not a member of this project')
  @ApiErrorResponseDoc(422, 'Validation failed')
  setNotificationSettings(
    @CurrentProject() access: ProjectAccessContext,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateProjectNotificationSettingsDto,
  ): Promise<ProjectNotificationSettings> {
    return this.members.setNotificationSettings(access, actor, dto.notifyOn);
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

  @Get('invitations')
  @RequireProjectAdmin()
  @ApiOperation({
    summary: 'List invitations waiting to land someone in this project',
    description: 'Newest first. Revoke one from the workspace invitations endpoint.',
  })
  @ApiEnvelopeResponse(WorkspaceInvitationDto, { isArray: true })
  listInvitations(@CurrentProject() access: ProjectAccessContext): Promise<WorkspaceInvitation[]> {
    return this.invitations.listForProject(access.workspaceId, access.projectId);
  }

  @Post('invitations')
  @RequireProjectAdmin()
  @ApiOperation({
    summary: 'Invite someone outside the workspace into this project',
    description:
      'Workspace admins only, as on the Members page. Sends a workspace invitation that also adds them to this project at the given role on acceptance. They join the workspace as a member, or as a guest for VIEWER; an address with a live invitation keeps its team and any higher role.',
  })
  @ApiEnvelopeResponse(WorkspaceInvitationDto, { status: 201 })
  @ApiErrorResponseDoc(403, 'The caller is not a workspace admin')
  @ApiErrorResponseDoc(409, 'That person is already in the workspace')
  @ApiErrorResponseDoc(422, 'Validation failed')
  invite(
    @CurrentProject() access: ProjectAccessContext,
    @Actor() actor: ActorContext,
    @Body() dto: InviteToProjectDto,
  ): Promise<WorkspaceInvitation> {
    return this.invitations.inviteToProject(
      access.workspaceId,
      access.projectId,
      actor.userId,
      dto,
    );
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
