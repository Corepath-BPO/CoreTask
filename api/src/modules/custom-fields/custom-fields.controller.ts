import type { WorkspaceRole } from '@coretask/contracts';
import type { CustomField, TaskCustomFieldValue } from '@coretask/types';
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
  SetCustomFieldValueDto,
  UpdateCustomFieldDto,
  UpdateFieldOptionDto,
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
    summary: 'Delete or archive a field',
    description:
      'Deleted outright when unused. Archived instead once tasks hold values, because the field is easy to recreate and its data is not.',
  })
  @ApiParam({ name: 'fieldId', format: 'uuid' })
  @ApiEnvelopeResponse(RemoveFieldResultDto)
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fieldId', ParseUUIDPipe) fieldId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: WorkspaceRole,
  ): Promise<{ deleted: boolean; archived: boolean }> {
    return this.fields.remove(workspaceId, projectId, userId, role, fieldId);
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
  ): Promise<void> {
    return this.fields.clearValue(workspaceId, taskId, fieldId);
  }
}
