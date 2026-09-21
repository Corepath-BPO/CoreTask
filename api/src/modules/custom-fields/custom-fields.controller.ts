import type { WorkspaceRole } from '@coretask/contracts';
import type { CustomField, RemoveFieldResult, TaskCustomFieldValue } from '@coretask/types';
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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentWorkspace } from '../../common/decorators/workspace.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { CustomFieldsService } from './custom-fields.service';
import {
  CustomFieldDto,
  RemoveFieldResultDto,
  TaskCustomFieldValueDto,
} from './dto/custom-field-response.dto';
import {
  CreateCustomFieldDto,
  CreateFieldOptionDto,
  RemoveFieldQueryDto,
  SetCustomFieldValueDto,
  UpdateCustomFieldDto,
  UpdateFieldOptionDto,
  UpdateWorkspaceCustomFieldDto,
} from './dto/custom-field.dto';

/**
 * Project-defined fields on tasks.
 *
 * Creating one makes it immediately available as a List column and as a filter,
 * with no frontend change — which is why operators are declared per field
 * *kind* rather than per field.
 */
@ApiTags('Custom fields')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/projects/:projectId/custom-fields')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'projectId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or not a manager for a write')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Get()
  @ApiOperation({ summary: 'List a project’s fields' })
  @ApiEnvelopeResponse(CustomFieldDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<CustomField[]> {
    return this.fields.list(workspaceId, projectId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a field',
    description: 'Select types must be created with at least one option; other types take none.',
  })
  @ApiEnvelopeResponse(CustomFieldDto, { status: 201 })
  @ApiErrorResponseDoc(409, 'This project already has a field by that name')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: CreateCustomFieldDto,
  ): Promise<CustomField> {
    return this.fields.create(workspaceId, projectId, userId, role, dto);
  }

  @Post(':fieldId/attach')
  @ApiOperation({
    summary: 'Use an existing workspace field on this project',
    description:
      'Creates an association, never a second definition, so two projects sharing a field really share it — including its options and everything reported across them.',
  })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiEnvelopeResponse(CustomFieldDto, { status: 201 })
  @ApiErrorResponseDoc(404, 'No such field in this workspace')
  @ApiErrorResponseDoc(403, 'Only a workspace manager can change a project’s fields')
  @ApiErrorResponseDoc(409, 'This project already uses that field')
  attach(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<CustomField> {
    return this.fields.attach(workspaceId, projectId, userId, role, fieldId);
  }

  @Get(':fieldId')
  @ApiOperation({ summary: 'Read one field' })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiEnvelopeResponse(CustomFieldDto)
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
  ): Promise<CustomField> {
    return this.fields.get(workspaceId, projectId, fieldId);
  }

  @Patch(':fieldId')
  @ApiOperation({
    summary: 'Update a field',
    description: 'The type cannot change — it would strand every value already stored.',
  })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiEnvelopeResponse(CustomFieldDto)
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdateCustomFieldDto,
  ): Promise<CustomField> {
    return this.fields.update(workspaceId, projectId, userId, role, fieldId, dto);
  }

  @Delete(':fieldId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a field from this project',
    description:
      '`?mode=detach` keeps the definition in the library; `?mode=delete` removes it from every project, archiving instead of deleting once tasks hold values. Without `mode` the outcome is chosen from state: detached while another project uses it, archived when values exist, deleted otherwise. Refused while a formula on this project reads the field.',
  })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiEnvelopeResponse(RemoveFieldResultDto)
  @ApiErrorResponseDoc(422, 'A formula on this project uses the field')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Query() query: RemoveFieldQueryDto,
  ): Promise<RemoveFieldResult> {
    return this.fields.remove(workspaceId, projectId, userId, role, fieldId, query.mode);
  }

  @Post(':fieldId/options')
  @ApiOperation({ summary: 'Add a select option' })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiEnvelopeResponse(CustomFieldDto, { status: 201 })
  addOption(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: CreateFieldOptionDto,
  ): Promise<CustomField> {
    return this.fields.addOption(workspaceId, projectId, role, fieldId, dto);
  }

  @Patch(':fieldId/options/:optionId')
  @ApiOperation({ summary: 'Update a select option' })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiEnvelopeResponse(CustomFieldDto)
  updateOption(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdateFieldOptionDto,
  ): Promise<CustomField> {
    return this.fields.updateOption(workspaceId, projectId, role, fieldId, optionId, dto);
  }

  @Delete(':fieldId/options/:optionId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete or archive a select option',
    description:
      'Archived when tasks still hold it, so their cells keep a label instead of a dangling id.',
  })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiParam({ name: 'optionId', format: 'uuid' })
  @ApiEnvelopeResponse(CustomFieldDto)
  removeOption(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @Param('optionId', ParseUUIDPipe) optionId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<CustomField> {
    return this.fields.removeOption(workspaceId, projectId, role, fieldId, optionId);
  }
}

/**
 * The definition on its own, with no project in the URL.
 *
 * A field detached from its last project and archived has no association
 * left to reach it through, so the project routes cannot restore it. This is
 * the one route the library needs that they cannot provide.
 */
@ApiTags('Custom fields')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/custom-fields')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Only a workspace manager can change a field')
export class WorkspaceCustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Patch(':fieldId')
  @ApiOperation({
    summary: 'Rename, re-describe, archive or restore a field',
    description:
      'Acts on the definition, so the change is seen by every project using the field. `isArchived: false` restores an archived field to the library.',
  })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiEnvelopeResponse(CustomFieldDto)
  @ApiErrorResponseDoc(404, 'No such field in this workspace')
  updateDefinition(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
    @Body() dto: UpdateWorkspaceCustomFieldDto,
  ): Promise<CustomField> {
    return this.fields.updateDefinition(workspaceId, userId, role, fieldId, dto);
  }
}

/**
 * Values live under the task, not the project: the task is what they belong to,
 * and the field id alone identifies which field within its project.
 */
@ApiTags('Custom fields')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tasks/:taskId/custom-fields')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'taskId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class TaskCustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  @Put(':fieldId')
  @ApiOperation({
    summary: 'Set a task’s value for a field',
    description:
      'Validated against the field definition: select values must name live options of that field, and people values must be workspace members.',
  })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskCustomFieldValueDto)
  @ApiErrorResponseDoc(400, 'The value does not fit the field definition')
  @ApiErrorResponseDoc(404, 'No such task or field')
  @ApiErrorResponseDoc(422, 'The field is calculated and cannot be set')
  setValue(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SetCustomFieldValueDto,
  ): Promise<TaskCustomFieldValue> {
    return this.fields.setValue(workspaceId, taskId, userId, fieldId, dto);
  }

  @Delete(':fieldId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear a task’s value for a field' })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  clearValue(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.fields.clearValue(workspaceId, taskId, fieldId, userId);
  }
}
