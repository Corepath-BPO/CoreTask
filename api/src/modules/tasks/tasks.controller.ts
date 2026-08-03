import { WorkspaceRole } from '@coretask/contracts';
import type { Task, TaskDetail, TaskListMeta } from '@coretask/types';
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
  ApiPaginatedEnvelopeResponse,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import type { PaginatedResult } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { TaskDetailDto, TaskDto } from './dto/task-response.dto';
import { CreateTaskDto, MoveTaskDto, TaskListQueryDto, UpdateTaskDto } from './dto/task.dto';
import { TasksService } from './tasks.service';

/**
 * Workspace-scoped rather than nested under a project: a task may have no
 * project, and "my tasks" spans every project. Project and section are filters.
 *
 * Reads are open to any member; MEMBER creates, edits and moves; MANAGER
 * archives, because that hides work from everyone.
 */
@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tasks')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({
    summary: 'List tasks',
    description:
      'Filter by project, section, assignee (`me` resolves to the caller), status, priority, due date or title. Returns a rollup in `meta.summary` computed over the whole filter, not just the page. Subtasks are excluded unless `includeSubtasks=true`.',
  })
  @ApiPaginatedEnvelopeResponse(TaskDto)
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Query() query: TaskListQueryDto,
  ): Promise<PaginatedResult<Task, TaskListMeta>> {
    return this.tasks.list(workspaceId, userId, query);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Create a task',
    description:
      'A `sectionId` implies its project. Pass `parentTaskId` to create a subtask; nesting is one level deep.',
  })
  @ApiEnvelopeResponse(TaskDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'Section/project mismatch, unknown assignee, or nesting too deep')
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateTaskDto,
  ): Promise<Task> {
    return this.tasks.create(workspaceId, userId, dto);
  }

  @Get(':taskId')
  @ApiOperation({ summary: 'Get a task with its subtasks and context' })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDetailDto)
  @ApiErrorResponseDoc(404, 'No such task in this workspace')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
  ): Promise<TaskDetail> {
    return this.tasks.getDetail(workspaceId, taskId);
  }

  @Patch(':taskId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Update a task',
    description:
      'Fields only. Section and ordering belong to `/move`, so a field edit can never reshuffle the board. `completedAt` is derived from `status`.',
  })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDto)
  @ApiErrorResponseDoc(404, 'No such task in this workspace')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<Task> {
    return this.tasks.update(workspaceId, userId, taskId, dto);
  }

  @Patch(':taskId/move')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move a task between or within sections',
    description: 'Ordering is relative to a sibling; the server owns the position arithmetic.',
  })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDto)
  @ApiErrorResponseDoc(400, 'The section belongs to a different project')
  move(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MoveTaskDto,
  ): Promise<Task> {
    return this.tasks.move(workspaceId, userId, taskId, dto);
  }

  @Delete(':taskId')
  @RequireWorkspaceRole(WorkspaceRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a task',
    description: 'Reversible, and takes the task’s subtasks with it. Requires MANAGER.',
  })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDto)
  @ApiErrorResponseDoc(409, 'The task is already archived')
  archive(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') userId: string,
  ): Promise<Task> {
    return this.tasks.archive(workspaceId, userId, taskId);
  }

  @Post(':taskId/restore')
  @RequireWorkspaceRole(WorkspaceRole.MANAGER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived task', description: 'Requires MANAGER.' })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDto)
  @ApiErrorResponseDoc(409, 'The task is not archived')
  restore(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') userId: string,
  ): Promise<Task> {
    return this.tasks.restore(workspaceId, userId, taskId);
  }
}
