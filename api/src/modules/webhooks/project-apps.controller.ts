import type { ProjectAppConnection } from '@coretask/types';
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

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import { RequireVerifiedEmail } from '../../common/decorators/email-verification.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { CreateProjectAppDto, UpdateProjectAppDto } from './dto/project-app.dto';
import { ProjectAppsService } from './project-apps.service';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/apps')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class ProjectAppsController {
  constructor(private readonly apps: ProjectAppsService) {}

  @Get()
  @ApiOperation({ summary: 'Chat apps the project posts its updates to' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectAppConnection[]> {
    return this.apps.list(workspaceId, projectId, actor);
  }

  @Post()
  @RequireVerifiedEmail()
  @ApiOperation({
    summary: 'Connect a chat app',
    description: 'Posts a hello to the channel straight away, so a wrong URL shows at once.',
  })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateProjectAppDto,
  ): Promise<ProjectAppConnection> {
    return this.apps.create(workspaceId, projectId, actor, dto);
  }

  @Patch(':appId')
  @ApiParam({ name: 'appId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename an app, change what it posts, or switch it off' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateProjectAppDto,
  ): Promise<ProjectAppConnection> {
    return this.apps.update(workspaceId, projectId, appId, actor, dto);
  }

  @Delete(':appId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'appId', format: 'uuid' })
  @ApiOperation({ summary: 'Disconnect an app' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.apps.remove(workspaceId, projectId, appId, actor);
  }

  @Post(':appId/test')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'appId', format: 'uuid' })
  @ApiOperation({ summary: 'Post a test message to the channel' })
  test(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('appId', ParseUUIDPipe) appId: string,
    @Actor() actor: ActorContext,
  ): Promise<{ deliveryId: string }> {
    return this.apps.test(workspaceId, projectId, appId, actor);
  }
}
