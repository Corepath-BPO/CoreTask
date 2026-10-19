import { PROJECT_RESOURCE_TITLE_MAX } from '@coretask/contracts';
import type { ProjectResource } from '@coretask/types';
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ProjectResourcesService } from './project-resources.service';

export class AddProjectResourceDto {
  @ApiProperty({ example: 'Project brief', description: 'Its host when left empty.' })
  @IsString()
  @MaxLength(PROJECT_RESOURCE_TITLE_MAX)
  title!: string;

  @ApiProperty({ example: 'https://docs.example.org/brief' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  url!: string;
}

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/resources')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class ProjectResourcesController {
  constructor(private readonly resources: ProjectResourcesService) {}

  @Get()
  @ApiOperation({ summary: "The project's key resources" })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectResource[]> {
    return this.resources.list(workspaceId, projectId, actor);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a key resource (its editors)',
    description: 'Answers with all of them.',
  })
  add(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: AddProjectResourceDto,
  ): Promise<ProjectResource[]> {
    return this.resources.add(workspaceId, projectId, actor, dto);
  }

  @Delete(':resourceId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'resourceId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a key resource (its editors)' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('resourceId', ParseUUIDPipe) resourceId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectResource[]> {
    return this.resources.remove(workspaceId, projectId, resourceId, actor);
  }
}
