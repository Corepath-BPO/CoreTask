import type { WorkspaceRole } from '@coretask/contracts';
import type { ProjectView } from '@coretask/types';
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
import { CurrentWorkspace } from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ProjectViewDto, DeleteViewResultDto } from './dto/project-view-response.dto';
import { CreateProjectViewDto, UpdateProjectViewDto } from './dto/project-view.dto';
import { ProjectViewsService } from './project-views.service';

/**
 * Saved ways of looking at a project's tasks.
 *
 * A view is presentation and never a copy of task data — List and Board read
 * the same tasks through the same endpoint, so deleting a view loses an
 * arrangement rather than any work.
 */
@ApiTags('Project views')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/views')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
@ApiErrorResponseDoc(404, 'No such project in this workspace')
export class ProjectViewsController {
  constructor(private readonly views: ProjectViewsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the views the caller can see',
    description:
      'Shared views plus the caller’s own personal ones. The project’s default List and Board are created on first read.',
  })
  @ApiEnvelopeResponse(ProjectViewDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ProjectView[]> {
    return this.views.list(workspaceId, projectId, userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a view',
    description: 'A guest may create personal views; a shared view needs MEMBER.',
  })
  @ApiEnvelopeResponse(ProjectViewDto, { status: 201 })
  @ApiErrorResponseDoc(422, 'Invalid view settings')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: CreateProjectViewDto,
  ): Promise<ProjectView> {
    return this.views.create(workspaceId, projectId, userId, role, dto);
  }

  @Get(':viewId')
  @ApiOperation({ summary: 'Read one view' })
  @ApiParam({ name: 'viewId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectViewDto)
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ProjectView> {
    return this.views.get(workspaceId, projectId, userId, viewId);
  }

  @Patch(':viewId')
  @ApiOperation({
    summary: 'Update a view',
    description: 'Settings are replaced in full and revalidated, never merged blindly.',
  })
  @ApiParam({ name: 'viewId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectViewDto)
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdateProjectViewDto,
  ): Promise<ProjectView> {
    return this.views.update(workspaceId, projectId, userId, role, viewId, dto);
  }

  @Post(':viewId/duplicate')
  @ApiOperation({ summary: 'Duplicate a view' })
  @ApiParam({ name: 'viewId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectViewDto, { status: 201 })
  duplicate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<ProjectView> {
    return this.views.duplicate(workspaceId, projectId, userId, role, viewId);
  }

  @Post(':viewId/set-default')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Make this the default view for its type',
    description: 'Scoped to the type, so a project keeps a default List and a default Board.',
  })
  @ApiParam({ name: 'viewId', format: 'uuid' })
  @ApiEnvelopeResponse(ProjectViewDto)
  @ApiErrorResponseDoc(400, 'A personal view cannot be the default for everyone')
  setDefault(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<ProjectView> {
    return this.views.setDefault(workspaceId, projectId, userId, role, viewId);
  }

  @Delete(':viewId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a view' })
  @ApiParam({ name: 'viewId', format: 'uuid' })
  @ApiEnvelopeResponse(DeleteViewResultDto)
  @ApiErrorResponseDoc(400, 'The default view cannot be deleted until another takes over')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('viewId', ParseUUIDPipe) viewId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<{ deleted: true }> {
    return this.views.remove(workspaceId, projectId, userId, role, viewId);
  }
}
