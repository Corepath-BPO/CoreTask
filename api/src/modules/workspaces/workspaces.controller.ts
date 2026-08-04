import { WorkspaceRole } from '@coretask/contracts';
import type { WorkspaceSummary } from '@coretask/types';
import {
  Body,
  Controller,
  Get,
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
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { WorkspaceSummaryDto } from './dto/workspace-response.dto';
import { CreateWorkspaceDto, UpdateWorkspaceDto } from './dto/workspace.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('Workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @Get()
  @ApiOperation({
    summary: 'List the workspaces the authenticated user belongs to',
    description: 'Scoped by membership. There is no endpoint that lists all workspaces.',
  })
  @ApiEnvelopeResponse(WorkspaceSummaryDto, { isArray: true })
  @ApiErrorResponseDoc(401, 'Missing or invalid access token')
  list(@CurrentUser('id') userId: string): Promise<WorkspaceSummary[]> {
    return this.workspaces.listForUser(userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a workspace',
    description: 'The creator is added as OWNER in the same transaction.',
  })
  @ApiEnvelopeResponse(WorkspaceSummaryDto, { status: 201 })
  @ApiErrorResponseDoc(409, 'The requested slug is already in use')
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWorkspaceDto,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.create(userId, dto);
  }

  @Get(':workspaceId')
  @UseGuards(WorkspaceMemberGuard)
  @ApiOperation({ summary: 'Get one workspace' })
  @ApiParam({ name: 'workspaceId', format: 'uuid' })
  @ApiEnvelopeResponse(WorkspaceSummaryDto)
  @ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.getForUser(workspaceId, userId);
  }

  @Patch(':workspaceId')
  @UseGuards(WorkspaceMemberGuard)
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @ApiOperation({ summary: 'Update workspace settings', description: 'Requires ADMIN or OWNER.' })
  @ApiParam({ name: 'workspaceId', format: 'uuid' })
  @ApiEnvelopeResponse(WorkspaceSummaryDto)
  @ApiErrorResponseDoc(403, 'Insufficient workspace role')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateWorkspaceDto,
  ): Promise<WorkspaceSummary> {
    return this.workspaces.update(workspaceId, userId, dto);
  }

  // `GET :workspaceId/members` moved to `MembersController` when roles became
  // editable — the path is unchanged, but reading and changing the roster now
  // live together.
}
