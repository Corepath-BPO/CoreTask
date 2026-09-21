import { WorkspaceRole } from '@coretask/contracts';
import type { ApiKey, CreatedApiKey } from '@coretask/types';
import { createApiKeySchema, updateApiKeySchema } from '@coretask/validation';
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

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

import { ApiKeysService } from './api-keys.service';
import { ApiKeyDto, CreatedApiKeyDto } from './dto/api-key-response.dto';

/**
 * Keys grant access to everything in the workspace, so managing them is
 * workspace administration — ADMIN and above, and never a key itself.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/api-keys')
@UseGuards(WorkspaceMemberGuard)
@RequireWorkspaceRole(WorkspaceRole.ADMIN)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not an administrator of this workspace, or the caller is an API key')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Get()
  @ApiOperation({
    summary: 'List API keys',
    description: 'Active keys by default; revoked ones only when asked for.',
  })
  @ApiQuery({ name: 'includeRevoked', required: false, type: Boolean })
  @ApiEnvelopeResponse(ApiKeyDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query('includeRevoked') includeRevoked?: string,
  ): Promise<ApiKey[]> {
    return this.apiKeys.list(workspaceId, includeRevoked === 'true');
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create an API key',
    description:
      'The secret is in this response and nowhere else afterwards. The key acts as a hidden service account named after it, at the role given (guest, member or manager — never above the caller’s own).',
  })
  @ApiEnvelopeResponse(CreatedApiKeyDto, { status: 201 })
  @ApiErrorResponseDoc(403, 'Attempted to grant a role above your own')
  @ApiErrorResponseDoc(409, 'The workspace already has the maximum number of keys')
  @ApiErrorResponseDoc(422, 'Validation failed, or the role is not one a key may hold')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: string,
    @Body() body: unknown,
  ): Promise<CreatedApiKey> {
    const input = parseBody(createApiKeySchema, body, 'The API key is invalid.');
    return this.apiKeys.create(workspaceId, { id: userId, role: role as WorkspaceRole }, input);
  }

  @Patch(':apiKeyId')
  @ApiOperation({ summary: 'Rename an API key or change its role' })
  @ApiParam({ name: 'apiKeyId', format: 'uuid' })
  @ApiEnvelopeResponse(ApiKeyDto)
  @ApiErrorResponseDoc(400, 'The key has been revoked')
  @ApiErrorResponseDoc(404, 'No such key in this workspace')
  @ApiErrorResponseDoc(422, 'Validation failed')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: string,
    @Body() body: unknown,
  ): Promise<ApiKey> {
    const input = parseBody(updateApiKeySchema, body, 'The change is invalid.');
    return this.apiKeys.update(
      workspaceId,
      { id: userId, role: role as WorkspaceRole },
      apiKeyId,
      input,
    );
  }

  @Delete(':apiKeyId')
  @ApiOperation({
    summary: 'Revoke an API key',
    description:
      'Final. The key stops authenticating immediately; the row is kept so history still names it.',
  })
  @ApiParam({ name: 'apiKeyId', format: 'uuid' })
  @ApiEnvelopeResponse(ApiKeyDto)
  @ApiErrorResponseDoc(404, 'No such key in this workspace')
  revoke(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('apiKeyId', ParseUUIDPipe) apiKeyId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: string,
  ): Promise<ApiKey> {
    return this.apiKeys.revoke(workspaceId, { id: userId, role: role as WorkspaceRole }, apiKeyId);
  }
}
