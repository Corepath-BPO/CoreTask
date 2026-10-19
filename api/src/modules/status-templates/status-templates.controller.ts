import type { StatusTemplate } from '@coretask/types';
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

import { CreateStatusTemplateDto, UpdateStatusTemplateDto } from './dto/status-template.dto';
import { StatusTemplatesService } from './status-templates.service';

@ApiTags('Status templates')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/status-templates')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not allowed to edit this project')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class StatusTemplatesController {
  constructor(private readonly templates: StatusTemplatesService) {}

  @Get()
  @ApiOperation({ summary: 'The project’s status templates, by name' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<StatusTemplate[]> {
    return this.templates.list(workspaceId, projectId, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Save a status template' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateStatusTemplateDto,
  ): Promise<StatusTemplate> {
    return this.templates.create(workspaceId, projectId, actor, dto);
  }

  @Patch(':templateId')
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOperation({ summary: 'Change a status template' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateStatusTemplateDto,
  ): Promise<StatusTemplate> {
    return this.templates.update(workspaceId, projectId, templateId, actor, dto);
  }

  @Delete(':templateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a status template', description: 'Posted updates stay.' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.templates.remove(workspaceId, projectId, templateId, actor);
  }
}
