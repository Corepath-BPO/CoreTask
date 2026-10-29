import { WorkspaceRole } from '@coretask/contracts';
import type {
  AsanaImportStatus,
  AsanaLiveSyncStatus,
  ImportRun,
  StartAsanaImportResult,
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
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/email-verification.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { AsanaImportService } from './asana-import.service';
import { SetAsanaLiveSyncDto } from './dto/live-sync.dto';

/**
 * Integrations › Asana. Workspace administration, and a person's own act:
 * an import makes a workspace and reads a whole Asana organisation, so no API
 * key or OAuth app may start one.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/integrations/asana')
@UseGuards(WorkspaceMemberGuard)
@RequireWorkspaceRole(WorkspaceRole.ADMIN)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not an administrator of this workspace, or the caller is an API key')
export class AsanaImportController {
  constructor(private readonly imports: AsanaImportService) {}

  @Get()
  @ApiOperation({
    summary: 'Whether Asana import is set up, and this workspace’s runs',
    description:
      'Says which settings are missing, whether you may import (only members of the Asana workspace may), which CoreTask workspace already holds the import, and the runs here.',
  })
  status(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
  ): Promise<AsanaImportStatus> {
    return this.imports.status(workspaceId, userId);
  }

  @Post('imports')
  @RequireVerifiedEmail()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Start an Asana import',
    description:
      'The first run creates a new workspace, owned by you, and imports into it. Later runs must be started from that workspace and update what the first one made. Asana is only read, never changed.',
  })
  @ApiErrorResponseDoc(400, 'This server has no Asana token set up')
  @ApiErrorResponseDoc(409, 'Already imported into another workspace, or a run is in progress')
  start(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
  ): Promise<StartAsanaImportResult> {
    return this.imports.start(workspaceId, userId);
  }

  @Put('live-sync')
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'Switch Asana live sync on or off',
    description:
      'While on, changes made in Asana come across within a minute or two, read from each imported project’s Asana event stream. Switching it on starts a full Sync again first. Asana is only read, never changed.',
  })
  @ApiErrorResponseDoc(400, 'This server has no Asana token set up')
  @ApiErrorResponseDoc(409, 'This workspace does not hold the Asana import')
  setLiveSync(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetAsanaLiveSyncDto,
  ): Promise<AsanaLiveSyncStatus> {
    return this.imports.setLiveSync(workspaceId, userId, dto.enabled);
  }

  @Get('imports/:runId')
  @ApiOperation({ summary: 'One import run: its progress and what it could not bring across' })
  @ApiParam({ name: 'runId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'No such run in this workspace')
  run(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ): Promise<ImportRun> {
    return this.imports.run(workspaceId, runId);
  }
}
