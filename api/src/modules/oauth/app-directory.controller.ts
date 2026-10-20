import { WorkspaceRole } from '@coretask/contracts';
import type { DirectoryApp, WorkspaceAppDirectory } from '@coretask/types';
import { approveWorkspaceAppSchema, updateAppPolicySchema } from '@coretask/validation';
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
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import {
  CurrentWorkspace,
  RequireWorkspaceRole,
} from '../../common/decorators/workspace.decorator';
import { parseBody } from '../../common/utils/zod-body.util';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AppDirectoryService } from './app-directory.service';
import { DirectoryAppDto, WorkspaceAppDirectoryDto } from './dto/oauth.dto';

/**
 * Integrations › App directory. Every member may look; admins choose whether
 * only approved apps may act in the workspace, and which those are.
 * Session-only: an app must never approve itself.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/app-directory')
@UseGuards(WorkspaceMemberGuard)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or the caller is an API key or an OAuth app')
export class AppDirectoryController {
  constructor(private readonly directory: AppDirectoryService) {}

  @Get()
  @ApiOperation({
    summary: 'The workspace’s app directory',
    description: 'Admins also get the apps members connected that are not in it.',
  })
  @ApiEnvelopeResponse(WorkspaceAppDirectoryDto)
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<WorkspaceAppDirectory> {
    return this.directory.get(workspaceId, userId, role);
  }

  @Patch()
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Allow any app, or only approved ones',
    description:
      'Under APPROVED, an app outside the directory is refused with OAUTH_APP_NOT_APPROVED and hears none of this workspace’s webhooks. Nobody is disconnected.',
  })
  @ApiEnvelopeResponse(WorkspaceAppDirectoryDto)
  @ApiErrorResponseDoc(422, 'Validation failed')
  setPolicy(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ): Promise<WorkspaceAppDirectory> {
    const input = parseBody(updateAppPolicySchema, body, 'The policy is invalid.');
    return this.directory.setPolicy(workspaceId, userId, input);
  }

  @Post('apps')
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Approve an app by its client id' })
  @ApiEnvelopeResponse(DirectoryAppDto, { status: 201 })
  @ApiErrorResponseDoc(404, 'No app has that client id')
  @ApiErrorResponseDoc(422, 'Validation failed')
  approve(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ): Promise<DirectoryApp> {
    const input = parseBody(approveWorkspaceAppSchema, body, 'The app is invalid.');
    return this.directory.approve(workspaceId, userId, input);
  }

  @Delete('apps/:appId')
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take an app out of the directory' })
  @ApiParam({ name: 'appId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'That app is not in the directory')
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('appId', ParseUUIDPipe) appId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.directory.remove(workspaceId, userId, appId);
  }
}
