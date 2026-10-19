import type { ProjectTemplate, StartedProject } from '@coretask/types';
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
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  CreateProjectTemplateDto,
  DuplicateProjectDto,
  StartProjectDto,
  UpdateProjectTemplateDto,
} from './dto/project-template.dto';
import { ProjectTemplatesService } from './project-templates.service';

@ApiTags('Project templates')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class ProjectTemplatesController {
  constructor(private readonly templates: ProjectTemplatesService) {}

  @Get('project-templates')
  @ApiOperation({ summary: 'The workspace’s project templates' })
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<ProjectTemplate[]> {
    return this.templates.list(workspaceId);
  }

  @Post('project-templates')
  @ApiOperation({ summary: 'Save a project as a template' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateProjectTemplateDto,
  ): Promise<ProjectTemplate> {
    return this.templates.create(workspaceId, actor, dto);
  }

  @Patch('project-templates/:templateId')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename a template, or change its description' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateProjectTemplateDto,
  ): Promise<ProjectTemplate> {
    return this.templates.update(workspaceId, templateId, actor, dto);
  }

  @Delete('project-templates/:templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a template', description: 'Projects started from it stay.' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.templates.remove(workspaceId, templateId, actor);
  }

  @Post('project-templates/:templateId/use')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOperation({
    summary: 'Start a project from a template',
    description: 'Task dates count from the start date given, or today.',
  })
  use(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Actor() actor: ActorContext,
    @Body() dto: StartProjectDto,
  ): Promise<StartedProject> {
    return this.templates.use(workspaceId, templateId, actor, dto);
  }

  @Post('projects/:projectId/duplicate')
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({
    summary: 'Duplicate a project',
    description: 'Sections always; tasks, rules, fields and the rest as chosen.',
  })
  duplicate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: DuplicateProjectDto,
  ): Promise<StartedProject> {
    return this.templates.duplicate(workspaceId, projectId, actor, dto);
  }
}
