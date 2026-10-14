import type { Task, TaskTemplate } from '@coretask/types';
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
  CreateTaskTemplateDto,
  UpdateTaskTemplateDto,
  UseTaskTemplateDto,
} from './dto/task-template.dto';
import { TaskTemplatesService } from './task-templates.service';

@ApiTags('Task templates')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/task-templates')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not allowed to edit this project')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class TaskTemplatesController {
  constructor(private readonly templates: TaskTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'The project’s task templates, by name' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskTemplate[]> {
    return this.templates.list(workspaceId, projectId, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Save a task template' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateTaskTemplateDto,
  ): Promise<TaskTemplate> {
    return this.templates.create(workspaceId, projectId, actor, dto);
  }

  @Patch(':templateId')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOperation({ summary: 'Change a task template' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateTaskTemplateDto,
  ): Promise<TaskTemplate> {
    return this.templates.update(workspaceId, projectId, templateId, actor, dto);
  }

  @Delete(':templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a task template', description: 'Tasks made from it stay.' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.templates.remove(workspaceId, projectId, templateId, actor);
  }

  @Post(':templateId/use')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOperation({
    summary: 'Create a task from a template',
    description: 'With its subtasks, in the chosen section or the project’s first.',
  })
  use(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UseTaskTemplateDto,
  ): Promise<Task> {
    return this.templates.use(workspaceId, projectId, templateId, actor, dto.sectionId);
  }
}
