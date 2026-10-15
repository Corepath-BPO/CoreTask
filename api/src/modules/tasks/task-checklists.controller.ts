import type { TaskChecklist } from '@coretask/types';
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
  AddChecklistItemDto,
  CreateChecklistDto,
  UpdateChecklistDto,
  UpdateChecklistItemDto,
} from './dto/checklist.dto';
import { TaskChecklistsService } from './task-checklists.service';

/** Every route answers with the task's checklists as they now are. */
@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tasks/:taskId/checklists')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'taskId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'The task, checklist or item is not visible to the caller')
export class TaskChecklistsController {
  constructor(private readonly checklists: TaskChecklistsService) {}

  @Get()
  @ApiOperation({ summary: 'A task’s checklists, each with its items' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskChecklist[]> {
    return this.checklists.list(workspaceId, taskId, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Add a checklist to a task' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateChecklistDto,
  ): Promise<TaskChecklist[]> {
    return this.checklists.create(workspaceId, taskId, actor, dto);
  }

  @Patch(':checklistId')
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename or move a checklist' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateChecklistDto,
  ): Promise<TaskChecklist[]> {
    return this.checklists.update(workspaceId, taskId, checklistId, actor, dto);
  }

  @Delete(':checklistId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a checklist and its items' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskChecklist[]> {
    return this.checklists.remove(workspaceId, taskId, checklistId, actor);
  }

  @Post(':checklistId/items')
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @ApiOperation({ summary: 'Add an item to the end of a checklist' })
  addItem(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Actor() actor: ActorContext,
    @Body() dto: AddChecklistItemDto,
  ): Promise<TaskChecklist[]> {
    return this.checklists.addItem(workspaceId, taskId, checklistId, actor, dto.title);
  }

  @Patch(':checklistId/items/:itemId')
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOperation({ summary: 'Tick, untick, rename or move a checklist item' })
  updateItem(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateChecklistItemDto,
  ): Promise<TaskChecklist[]> {
    return this.checklists.updateItem(workspaceId, taskId, checklistId, itemId, actor, dto);
  }

  @Delete(':checklistId/items/:itemId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'checklistId', format: 'uuid' })
  @ApiParam({ name: 'itemId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a checklist item' })
  removeItem(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('checklistId', ParseUUIDPipe) checklistId: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskChecklist[]> {
    return this.checklists.removeItem(workspaceId, taskId, checklistId, itemId, actor);
  }
}
