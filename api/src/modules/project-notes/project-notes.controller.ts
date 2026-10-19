import type { ProjectNote } from '@coretask/types';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ProjectNotesService } from './project-notes.service';

export class SaveProjectNoteDto {
  @ApiProperty({ description: 'Rich text; empty clears the note.' })
  @IsString()
  @MaxLength(400_000)
  body!: string;
}

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/note')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class ProjectNotesController {
  constructor(private readonly notes: ProjectNotesService) {}

  @Get()
  @ApiOperation({ summary: "The project's note, and who changed it last" })
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectNote> {
    return this.notes.get(workspaceId, projectId, actor);
  }

  @Put()
  @ApiOperation({ summary: "Save the project's note (its editors)" })
  save(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: SaveProjectNoteDto,
  ): Promise<ProjectNote> {
    return this.notes.save(workspaceId, projectId, actor, dto.body);
  }
}
