import { WorkspaceRole } from '@coretask/contracts';
import type { SamlConnection, WorkspaceDomain } from '@coretask/types';
import { samlConnectionSchema, workspaceDomainSchema } from '@coretask/validation';
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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import { parseBody } from '../../common/utils/zod-body.util';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { WorkspaceSsoService } from './workspace-sso.service';

/** Settings › Single sign-on: the workspace's SAML provider and its verified domains. Admins and owners. */
@ApiTags('Workspaces')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId')
@UseGuards(WorkspaceMemberGuard)
@RequireWorkspaceRole(WorkspaceRole.ADMIN)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Insufficient workspace role')
export class WorkspaceSsoController {
  constructor(private readonly sso: WorkspaceSsoService) {}

  @Get('saml')
  @ApiOperation({
    summary: 'The workspace’s SAML connection',
    description: 'Null when there is none. Includes the addresses to give the identity provider.',
  })
  getConnection(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<SamlConnection | null> {
    return this.sso.getConnection(workspaceId);
  }

  @Put('saml')
  @ApiOperation({
    summary: 'Set up or change the SAML connection',
    description:
      'The identity provider’s entity ID, sign-in URL and signing certificate (PEM, or the bare base64). Nobody can sign in through it until `enabled` is true.',
  })
  @ApiErrorResponseDoc(422, 'Validation failed, or the certificate cannot be read')
  upsertConnection(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ): Promise<SamlConnection> {
    const input = parseBody(samlConnectionSchema, body, 'The SAML settings are invalid.');
    return this.sso.upsertConnection(workspaceId, userId, input);
  }

  @Delete('saml')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove the SAML connection',
    description: 'Disconnects everyone who signed in through it; their accounts stay.',
  })
  @ApiErrorResponseDoc(404, 'There is no connection')
  async deleteConnection(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.sso.deleteConnection(workspaceId, userId);
  }

  @Get('domains')
  @ApiOperation({
    summary: 'The e-mail domains the workspace has claimed, and the TXT record for each',
  })
  listDomains(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<WorkspaceDomain[]> {
    return this.sso.listDomains(workspaceId);
  }

  @Post('domains')
  @ApiOperation({
    summary: 'Claim an e-mail domain',
    description: 'Unverified until the TXT record it answers is published and checked.',
  })
  @ApiErrorResponseDoc(409, 'Already on the list')
  @ApiErrorResponseDoc(422, 'Not a domain')
  addDomain(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ): Promise<WorkspaceDomain> {
    const input = parseBody(workspaceDomainSchema, body, 'Enter a domain such as example.com.');
    return this.sso.addDomain(workspaceId, userId, input);
  }

  @Delete('domains/:domainId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a domain' })
  @ApiParam({ name: 'domainId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'Not on the list')
  async removeDomain(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.sso.removeDomain(workspaceId, domainId, userId);
  }

  @Post('domains/:domainId/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check the domain’s TXT record',
    description: 'Looks the record up in DNS now. A domain can be verified by one workspace only.',
  })
  @ApiParam({ name: 'domainId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'The TXT record was not found')
  @ApiErrorResponseDoc(409, 'Another workspace has verified it')
  verifyDomain(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
    @CurrentUser('id') userId: string,
  ): Promise<WorkspaceDomain> {
    return this.sso.verifyDomain(workspaceId, domainId, userId);
  }
}
