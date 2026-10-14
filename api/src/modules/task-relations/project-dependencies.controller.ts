import type { ProjectDependency } from '@coretask/types';
import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { TaskRelationsService } from './task-relations.service';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/dependencies')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class ProjectDependenciesController {
  constructor(private readonly relations: TaskRelationsService) {}

  @Get()
  @ApiOperation({ summary: "Every dependency between two of the project's tasks" })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectDependency[]> {
    return this.relations.projectDependencies(workspaceId, projectId, actor);
  }
}
