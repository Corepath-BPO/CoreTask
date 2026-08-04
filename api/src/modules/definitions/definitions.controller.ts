import type { WorkspaceRole } from '@coretask/contracts';
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
import type { PriorityDefinition, StatusDefinition } from '@prisma/client';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentWorkspace } from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { DefinitionsService } from './definitions.service';
import { PriorityDefinitionDto, StatusDefinitionDto } from './dto/definition-response.dto';
import {
  CreatePriorityDto,
  CreateStatusDto,
  ReorderDto,
  UpdatePriorityDto,
  UpdateStatusDto,
} from './dto/definition.dto';

/**
 * A project's task statuses.
 *
 * Project-scoped with a workspace fallback: a project that has defined none
 * uses the workspace set, and defining its first status copies the whole set
 * forward so an override never starts incomplete.
 */
@ApiTags('Statuses')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/statuses')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or not a manager for a write')
export class ProjectStatusesController {
  constructor(private readonly definitions: DefinitionsService) {}

  @Get()
  @ApiOperation({ summary: 'List the statuses this project uses' })
  @ApiEnvelopeResponse(StatusDefinitionDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<StatusDefinition[]> {
    return this.definitions.listStatuses(workspaceId, projectId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a status',
    description: 'The first project status copies the workspace set forward.',
  })
  @ApiEnvelopeResponse(StatusDefinitionDto, { status: 201 })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: CreateStatusDto,
  ): Promise<StatusDefinition> {
    return this.definitions.createStatus(workspaceId, projectId, role, dto);
  }

  @Patch(':statusId')
  @ApiOperation({ summary: 'Update a status' })
  @ApiParam({ name: 'statusId', format: 'uuid' })
  @ApiEnvelopeResponse(StatusDefinitionDto)
  @ApiErrorResponseDoc(400, 'Archiving a status tasks still hold')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdateStatusDto,
  ): Promise<StatusDefinition> {
    return this.definitions.updateStatus(workspaceId, projectId, role, statusId, dto);
  }

  @Delete(':statusId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a status',
    description: 'Refused while any task holds it, so nothing is left pointing at nothing.',
  })
  @ApiParam({ name: 'statusId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'Tasks still use this status, or it is the default')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('statusId', ParseUUIDPipe) statusId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<{ deleted: true }> {
    return this.definitions.removeStatus(workspaceId, projectId, role, statusId);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder statuses' })
  @ApiEnvelopeResponse(StatusDefinitionDto, { isArray: true })
  reorder(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: ReorderDto,
  ): Promise<StatusDefinition[]> {
    return this.definitions.reorderStatuses(workspaceId, projectId, role, dto);
  }
}

/**
 * Priorities are workspace-scoped, not per project.
 *
 * "High" meaning different things in two projects makes every cross-project
 * view — My Tasks, the dashboard — incoherent.
 */
@ApiTags('Priorities')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/priorities')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or not a manager for a write')
export class PrioritiesController {
  constructor(private readonly definitions: DefinitionsService) {}

  @Get()
  @ApiOperation({ summary: 'List the workspace priorities' })
  @ApiEnvelopeResponse(PriorityDefinitionDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ): Promise<PriorityDefinition[]> {
    return this.definitions.listPriorities(workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a priority' })
  @ApiEnvelopeResponse(PriorityDefinitionDto, { status: 201 })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: CreatePriorityDto,
  ): Promise<PriorityDefinition> {
    return this.definitions.createPriority(workspaceId, role, dto);
  }

  @Patch(':priorityId')
  @ApiOperation({ summary: 'Update a priority' })
  @ApiParam({ name: 'priorityId', format: 'uuid' })
  @ApiEnvelopeResponse(PriorityDefinitionDto)
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('priorityId', ParseUUIDPipe) priorityId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdatePriorityDto,
  ): Promise<PriorityDefinition> {
    return this.definitions.updatePriority(workspaceId, role, priorityId, dto);
  }

  @Delete(':priorityId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a priority' })
  @ApiParam({ name: 'priorityId', format: 'uuid' })
  @ApiErrorResponseDoc(400, 'Tasks still use this priority')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('priorityId', ParseUUIDPipe) priorityId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<{ deleted: true }> {
    return this.definitions.removePriority(workspaceId, role, priorityId);
  }

  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reorder priorities' })
  @ApiEnvelopeResponse(PriorityDefinitionDto, { isArray: true })
  reorder(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: ReorderDto,
  ): Promise<PriorityDefinition[]> {
    return this.definitions.reorderPriorities(workspaceId, role, dto);
  }
}
