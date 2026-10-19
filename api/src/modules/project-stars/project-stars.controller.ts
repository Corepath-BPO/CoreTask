import type { StarredProject } from '@coretask/types';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ProjectStarsService } from './project-stars.service';

/** Swagger model mirroring `StarredProject` in `@coretask/types`. */
class StarredProjectDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Platform Foundation' })
  name!: string;

  @ApiProperty({ example: 'PLAT' })
  key!: string;

  @ApiProperty({ example: '#6366F1' })
  color!: string;

  @ApiProperty({ example: 'ACTIVE' })
  status!: string;

  @ApiProperty({ example: 1024 })
  position!: number;
}

/**
 * Under the workspace, not `/projects/:id`, for the list: a static segment
 * beside a UUID parameter is a routing trap waiting for the next refactor.
 */
@ApiTags('Projects')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class ProjectStarsController {
  constructor(private readonly stars: ProjectStarsService) {}

  @Get('starred-projects')
  @ApiOperation({
    summary: 'The caller’s starred projects',
    description:
      'In sidebar order. Archived projects, and private ones the caller cannot open, are left out.',
  })
  @ApiEnvelopeResponse(StarredProjectDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<StarredProject[]> {
    return this.stars.list(workspaceId, actor);
  }

  @Put('projects/:projectId/star')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({
    summary: 'Star a project',
    description: 'Appends to the end of the caller’s list. Starring twice is a no-op.',
  })
  @ApiEnvelopeResponse(StarredProjectDto, { isArray: true })
  @ApiErrorResponseDoc(400, 'Too many starred projects')
  @ApiErrorResponseDoc(404, 'No such project, or it is private and closed to the caller')
  star(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<StarredProject[]> {
    return this.stars.star(workspaceId, projectId, actor);
  }

  @Delete('projects/:projectId/star')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'Unstar a project' })
  @ApiEnvelopeResponse(StarredProjectDto, { isArray: true })
  unstar(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<StarredProject[]> {
    return this.stars.unstar(workspaceId, projectId, actor);
  }
}
