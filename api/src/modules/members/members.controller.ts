import type { RemoveMemberResult, WorkspaceMember } from '@coretask/types';
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
import { WorkspaceMemberDto } from '../workspaces/dto/workspace-response.dto';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';
import { WorkspaceMembersService } from '../workspace-members/workspace-members.service';

import { RemoveMemberResultDto, UpdateMemberRoleDto } from './dto/member.dto';
import { MembersService } from './members.service';

/**
 * Reading the roster is open to any member — you cannot collaborate with people
 * you cannot see. Changing it is not, and the rules are enforced in the service
 * rather than by a role decorator: every one of them depends on the *target's*
 * current role as well as the caller's, which a decorator cannot know.
 */
@ApiTags('Members')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/members')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly roster: WorkspaceMembersService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List workspace members' })
  @ApiEnvelopeResponse(WorkspaceMemberDto, { isArray: true })
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<WorkspaceMember[]> {
    return this.roster.listMembers(workspaceId);
  }

  @Patch(':memberId')
  @ApiOperation({
    summary: 'Change a member’s role',
    description:
      'Requires ADMIN, and the caller must outrank the member. The new role may not exceed the caller’s own, and can never be OWNER.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiEnvelopeResponse(WorkspaceMemberDto)
  @ApiErrorResponseDoc(403, 'Outranked, acting on yourself, or granting too high a role')
  @ApiErrorResponseDoc(404, 'No such member in this workspace')
  updateRole(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ): Promise<WorkspaceMember> {
    return this.members.updateRole(workspaceId, userId, memberId, dto.role);
  }

  @Delete(':memberId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a member, or leave',
    description:
      'Removing someone else requires ADMIN and outranking them. Removing yourself is leaving, and needs no particular role. Either way the person’s open tasks and tickets are unassigned. The owner can do neither until ownership is transferred.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiEnvelopeResponse(RemoveMemberResultDto)
  @ApiErrorResponseDoc(400, 'The owner cannot be removed or leave')
  @ApiErrorResponseDoc(403, 'Outranked by the member being removed')
  @ApiErrorResponseDoc(404, 'No such member in this workspace')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
  ): Promise<RemoveMemberResult> {
    return this.members.remove(workspaceId, userId, memberId);
  }

  @Post(':memberId/transfer-ownership')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Transfer ownership to another member',
    description:
      'Owner only. The outgoing owner becomes an ADMIN rather than losing access, and both changes share a transaction so the workspace never has two owners or none.',
  })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiEnvelopeResponse(WorkspaceMemberDto)
  @ApiErrorResponseDoc(400, 'Attempted to transfer ownership to yourself')
  @ApiErrorResponseDoc(403, 'Only the owner can transfer ownership')
  @ApiErrorResponseDoc(404, 'No such member in this workspace')
  transferOwnership(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @CurrentUser('id') userId: string,
  ): Promise<WorkspaceMember> {
    return this.members.transferOwnership(workspaceId, userId, memberId);
  }
}
