import { WorkspaceRole } from '@coretask/contracts';
import type {
  AdminDeactivateResult,
  AdminInvitationLink,
  AdminMember,
  AdminOverview,
  AdminTeam,
  RemoveMemberResult,
} from '@coretask/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import { InvitationsService } from '../invitations/invitations.service';
import { MembersService } from '../members/members.service';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AdminService } from './admin.service';
import { HandOverDto } from './dto/admin.dto';

/**
 * The admin console, modelled on Asana's: a workspace as a whole, for its
 * super admins and its owner.
 *
 * The gate is the class's, so no route here can be added without it: a super
 * admin's own session, never an API key or an OAuth app acting for one. Role
 * changes and ownership transfer stay on the Members routes, whose rules
 * already rank a super admin above an admin.
 */
@ApiTags('Admin console')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/admin')
@UseGuards(WorkspaceMemberGuard)
@RequireWorkspaceRole(WorkspaceRole.SUPER_ADMIN)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a super admin of this workspace, or the caller is an API key')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly members: MembersService,
    private readonly invitations: InvitationsService,
  ) {}

  @Get('overview')
  @ApiOperation({
    summary: 'The workspace in numbers',
    description:
      'People by role and status, invitations, teams, projects, tasks, storage, automation runs, SSO and the Asana sync.',
  })
  overview(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<AdminOverview> {
    return this.admin.overview(workspaceId);
  }

  @Get('members')
  @ApiOperation({
    summary: 'Every member, deactivated ones included',
    description:
      'With last activity, sign-in methods, two-step verification and open work, for deciding about each person.',
  })
  listMembers(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<AdminMember[]> {
    return this.admin.listMembers(workspaceId);
  }

  @Post('members/:memberId/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Deactivate a member',
    description:
      'They lose access at once but keep their role, teams and projects for reactivation. Their open tasks and tickets go to `reassignToUserId` in the projects that member may be assigned in (its members, or the owner anywhere), and are unassigned otherwise. The owner cannot be deactivated, and you must outrank the member.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'The owner, or a recipient who is not an active member')
  @ApiErrorResponseDoc(403, 'Outranked by the member, or acting on yourself')
  @ApiErrorResponseDoc(409, 'Already deactivated')
  async deactivate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: HandOverDto,
  ): Promise<AdminDeactivateResult> {
    const counts = await this.members.deactivate(workspaceId, userId, memberId, {
      reassignToUserId: dto.reassignToUserId,
    });
    return { member: await this.admin.readMember(workspaceId, memberId), ...counts };
  }

  @Post('members/:memberId/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Give a deactivated member their access back' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiErrorResponseDoc(403, 'Outranked by the member')
  @ApiErrorResponseDoc(409, 'Not deactivated')
  async reactivate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
  ): Promise<AdminMember> {
    await this.members.reactivate(workspaceId, userId, memberId);
    return this.admin.readMember(workspaceId, memberId);
  }

  @Post('members/:memberId/remove')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a member, handing their work to someone',
    description:
      'As the Members page’s remove, with the hand-over of `deactivate`: their open work goes to `reassignToUserId` in the projects that member may be assigned in.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'The owner, or a recipient who is not an active member')
  @ApiErrorResponseDoc(403, 'Outranked by the member')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: HandOverDto,
  ): Promise<RemoveMemberResult> {
    return this.members.remove(workspaceId, userId, memberId, {
      reassignToUserId: dto.reassignToUserId,
    });
  }

  @Get('teams')
  @ApiOperation({ summary: 'Every team, with member and project counts' })
  listTeams(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<AdminTeam[]> {
    return this.admin.listTeams(workspaceId);
  }

  @Post('invitations/:invitationId/link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'A new link for a pending invitation',
    description:
      'For passing on by hand when the e-mail does not arrive. It replaces the previous link, and accepting still needs an account at the invited address.',
  })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'No pending invitation by that id here')
  invitationLink(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser('id') userId: string,
  ): Promise<AdminInvitationLink> {
    return this.invitations.issueLink(workspaceId, userId, invitationId);
  }
}
