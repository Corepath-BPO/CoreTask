import { WorkspaceRole } from '@coretask/contracts';
import type { ProjectDetail, ProjectSummary } from '@coretask/types';
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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
  ApiPaginatedEnvelopeResponse,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import type { PaginatedResult } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ProjectDetailDto, ProjectSummaryDto } from './dto/project-response.dto';
import { CreateProjectDto, ProjectListQueryDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

/**
 * Mounted under the workspace so `WorkspaceMemberGuard` sees `:workspaceId` and
 * every route is tenant-scoped by construction.
 *
 * Reading is open to any member (including GUEST); creating and editing needs
 * MEMBER; archiving needs MANAGER, because it hides work from everyone.
 */
@ApiTags('Projects')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @ApiOperation({
    summary: 'List projects in a workspace',
    description: 'Archived projects are excluded unless `includeArchived=true`.',
  })
  @ApiPaginatedEnvelopeResponse(ProjectSummaryDto)
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: ProjectListQueryDto,
  ): Promise<PaginatedResult<ProjectSummary>> {
    return this.projects.list(workspaceId, query);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Create a project',
    description:
      'Derives a unique key from the name when none is supplied, and creates the default sections so the board is usable immediately.',
  })
  @ApiEnvelopeResponse(ProjectDetailDto, { status: 201 })
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectDetail> {
    return this.projects.create(workspaceId, userId, dto);
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Get a project with its ordered sections' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectDetailDto)
  @ApiErrorResponseDoc(404, 'No such project in this workspace')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectDetail> {
    return this.projects.getDetail(workspaceId, projectId);
  }

  @Patch(':projectId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Update a project',
    description: 'The key is immutable — it is embedded in every ticket reference.',
  })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectSummaryDto)
  @ApiErrorResponseDoc(404, 'No such project in this workspace')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectSummary> {
    return this.projects.update(workspaceId, userId, projectId, dto);
  }

  @Delete(':projectId')
  @RequireWorkspaceRole(WorkspaceRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a project',
    description:
      'Reversible. Tasks, tickets and activity keep referring to the project, so it is archived rather than deleted. Requires MANAGER.',
  })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectSummaryDto)
  @ApiErrorResponseDoc(409, 'The project is already archived')
  archive(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ProjectSummary> {
    return this.projects.archive(workspaceId, userId, projectId);
  }

  @Post(':projectId/restore')
  @RequireWorkspaceRole(WorkspaceRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived project', description: 'Requires MANAGER.' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectSummaryDto)
  @ApiErrorResponseDoc(409, 'The project is not archived')
  restore(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ProjectSummary> {
    return this.projects.restore(workspaceId, userId, projectId);
  }
}
