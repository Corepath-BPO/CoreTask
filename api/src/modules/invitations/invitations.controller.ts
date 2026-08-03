import { WorkspaceRole } from '@coretask/contracts';
import type {
  AcceptInvitationResult,
  WorkspaceInvitation,
  WorkspaceInvitationPreview,
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
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import {
  CurrentWorkspace,
  RequireWorkspaceRole,
} from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  AcceptInvitationResultDto,
  WorkspaceInvitationDto,
  WorkspaceInvitationPreviewDto,
} from './dto/invitation-response.dto';
import { CreateInvitationDto } from './dto/invitation.dto';
import { InvitationsService } from './invitations.service';

/**
 * Managing who has been invited is workspace administration, so it sits behind
 * the workspace guard at ADMIN and above. Inviting someone is how membership —
 * and therefore access to everything in the workspace — is granted.
 */
@ApiTags('Invitations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/invitations')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not an administrator of this workspace')
export class WorkspaceInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'List outstanding invitations',
    description: 'Pending only — accepted and revoked offers drop out.',
  })
  @ApiEnvelopeResponse(WorkspaceInvitationDto, { isArray: true })
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<WorkspaceInvitation[]> {
    return this.invitations.list(workspaceId);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Invite someone by e-mail',
    description:
      'Re-inviting an address refreshes the existing offer with a new token, so there is never more than one live link per person. The role may not exceed the inviter’s own, and can never be OWNER.',
  })
  @ApiEnvelopeResponse(WorkspaceInvitationDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'Too many invitations already outstanding')
  @ApiErrorResponseDoc(403, 'Attempted to grant a role above your own')
  @ApiErrorResponseDoc(409, 'That person is already a member')
  @ApiErrorResponseDoc(422, 'Validation failed')
  invite(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: string,
    @Body() dto: CreateInvitationDto,
  ): Promise<WorkspaceInvitation> {
    return this.invitations.invite(workspaceId, userId, role as WorkspaceRole, dto);
  }

  @Delete(':invitationId')
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoke an invitation',
    description: 'The link stops working immediately.',
  })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'No such pending invitation in this workspace')
  revoke(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.invitations.revoke(workspaceId, userId, invitationId);
  }
}

/**
 * Redeeming an invitation cannot live under `/workspaces/:workspaceId`: the
 * holder is not a member yet, so `WorkspaceMemberGuard` would turn them away
 * from the very route that would make them one. The token names the workspace.
 *
 * The preview is `@Public()` because the usual recipient has no account at all —
 * the page has to be able to say which workspace they are being invited to
 * before offering them a sign-in. Accepting still requires a session.
 */
@ApiTags('Invitations')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Public()
  @Get(':token')
  @ApiOperation({
    summary: 'Look up an invitation by token',
    description:
      'Returns only what the accept page needs. Unknown, revoked, spent and expired tokens are all reported the same way, so the endpoint cannot be used to probe for links.',
  })
  @ApiParam({ name: 'token', description: 'The opaque value from the e-mail link.' })
  @ApiEnvelopeResponse(WorkspaceInvitationPreviewDto)
  @ApiErrorResponseDoc(404, 'The invitation is unknown, revoked, already used, or expired')
  preview(@Param('token') token: string): Promise<WorkspaceInvitationPreview> {
    return this.invitations.preview(token);
  }

  @Post(':token/accept')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept an invitation',
    description:
      'Joins the signed-in account to the workspace. The account’s e-mail must match the address the invitation was sent to.',
  })
  @ApiParam({ name: 'token' })
  @ApiEnvelopeResponse(AcceptInvitationResultDto)
  @ApiErrorResponseDoc(401, 'Missing or invalid access token')
  @ApiErrorResponseDoc(403, 'Signed in as a different e-mail address')
  @ApiErrorResponseDoc(404, 'The invitation is unknown, revoked, already used, or expired')
  accept(
    @Param('token') token: string,
    @CurrentUser('id') userId: string,
  ): Promise<AcceptInvitationResult> {
    return this.invitations.accept(token, userId);
  }
}
