import { WorkspaceRole } from '@coretask/contracts';
import type { Section } from '@coretask/types';
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
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { SectionDto } from './dto/section-response.dto';
import { CreateSectionDto, MoveSectionDto, UpdateSectionDto } from './dto/section.dto';
import { SectionDeleteResultDto } from './dto/section-delete-result.dto';
import { SectionsService } from './sections.service';

@ApiTags('Sections')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/sections')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
@ApiErrorResponseDoc(404, 'No such project in this workspace')
export class SectionsController {
  constructor(private readonly sections: SectionsService) {}

  @Get()
  @ApiOperation({ summary: "List a project's sections, ordered left to right" })
  @ApiEnvelopeResponse(SectionDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<Section[]> {
    return this.sections.list(workspaceId, projectId);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Add a section',
    description: 'Appends by default; pass `afterSectionId` to insert at a specific place.',
  })
  @ApiEnvelopeResponse(SectionDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'The section limit is reached, or the anchor is not in this project')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateSectionDto,
  ): Promise<Section> {
    return this.sections.create(workspaceId, userId, projectId, dto);
  }

  @Patch(':sectionId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({ summary: 'Rename a section' })
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiEnvelopeResponse(SectionDto)
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSectionDto,
  ): Promise<Section> {
    return this.sections.update(workspaceId, userId, projectId, sectionId, dto);
  }

  @Patch(':sectionId/move')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reorder a section',
    description:
      'Returns the full ordered list: a reorder can renumber every sibling, so the client should not have to guess which ones moved.',
  })
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiEnvelopeResponse(SectionDto, { isArray: true })
  move(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MoveSectionDto,
  ): Promise<Section[]> {
    return this.sections.move(workspaceId, userId, projectId, sectionId, dto);
  }

  @Delete(':sectionId')
  @RequireWorkspaceRole(WorkspaceRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a section',
    description:
      'Requires MANAGER. Tasks in the section move to the leftmost remaining section rather than being orphaned.',
  })
  @ApiParam({ name: 'sectionId', format: 'uuid' })
  @ApiEnvelopeResponse(SectionDeleteResultDto)
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser('id') userId: string,
  ): Promise<{ deleted: true; reassignedTaskCount: number }> {
    return this.sections.remove(workspaceId, userId, projectId, sectionId);
  }
}
