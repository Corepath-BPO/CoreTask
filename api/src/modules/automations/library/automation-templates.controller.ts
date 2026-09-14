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

import { ApiErrorResponseDoc } from '../../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../../workspace-members/workspace-member.guard';
import {
  ApplyAutomationTemplateDto,
  SaveAutomationTemplateDto,
  UpdateAutomationTemplateDto,
} from '../dto/automation-template.dto';

import { AutomationTemplatesService } from './automation-templates.service';

/**
 * The rule library: rules saved to be started from again, in any project.
 *
 * Workspace-scoped rather than under a project, because a template belongs to
 * nobody's project — that is the difference between it and `duplicate`, which
 * copies a rule beside itself.
 */
@ApiTags('Automations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/automation-templates')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or not a manager for a write')
export class AutomationTemplatesController {
  constructor(private readonly templates: AutomationTemplatesService) {}

  @Get()
  @ApiOperation({
    summary: 'The workspace’s rule library',
    description:
      'Every saved template with its graph, sorted by name. Any member may browse; ' +
      'only a manager can add to it or apply from it, because either creates or copies a rule.',
  })
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string) {
    return this.templates.list(workspaceId);
  }

  @Post()
  @ApiOperation({
    summary: 'Save a rule to the library',
    description:
      'Snapshots the rule’s current graph. The template does not follow the rule afterwards: ' +
      'editing, archiving or deleting the rule leaves the template as it was saved. The names ' +
      'behind the rule’s sections, statuses and fields are recorded with it, so applying it in ' +
      'another project can match them by name.',
  })
  @ApiErrorResponseDoc(400, 'The rule has no steps to save')
  @ApiErrorResponseDoc(404, 'No such rule in that project')
  save(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: SaveAutomationTemplateDto,
  ) {
    return this.templates.saveFromRule(workspaceId, userId, role, dto);
  }

  @Patch(':templateId')
  @ApiOperation({ summary: 'Rename or describe a template' })
  @ApiParam({ name: 'templateId', format: 'uuid' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdateAutomationTemplateDto,
  ) {
    return this.templates.update(workspaceId, role, templateId, dto);
  }

  @Delete(':templateId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a template from the library',
    description: 'Rules already started from it are unaffected — they carry no link back.',
  })
  @ApiParam({ name: 'templateId', format: 'uuid' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ) {
    return this.templates.remove(workspaceId, role, templateId);
  }

  @Post(':templateId/apply')
  @ApiOperation({
    summary: 'Start a rule in a project from a template',
    description:
      'Creates a DRAFT in the given project, never a live rule. Sections, statuses, fields and ' +
      'options the template names are kept where the project has the same row, matched by ' +
      'name where it does not, and otherwise left blank and listed in `unresolved` for the ' +
      'builder to ask about. Nothing is refused for failing to match — the draft cannot ' +
      'publish until the blanks are filled, and that is the check.',
  })
  @ApiParam({ name: 'templateId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'No such template, project, or section in that project')
  apply(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('templateId', ParseUUIDPipe) templateId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: ApplyAutomationTemplateDto,
  ) {
    return this.templates.apply(workspaceId, userId, role, templateId, dto);
  }
}
