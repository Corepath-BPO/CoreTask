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
import { Idempotent } from '../../common/decorators/idempotent.decorator';
import { Actor, RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import type { ActorContext, PaginatedResult } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { TaskDetailDto, TaskDto } from './dto/task-response.dto';
import {
  AddTaskToProjectDto,
  MarkDuplicateDto,
  CreateTaskDto,
  MoveTaskDto,
  SetTaskProjectSectionDto,
  TaskListQueryDto,
  UpdateTaskDto,
} from './dto/task.dto';
import { TaskProjectsService } from './task-projects.service';
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
  constructor(
    private readonly tasks: TasksService,
    private readonly taskProjects: TaskProjectsService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List tasks',
    description:
      'Filter by project, section, assignee (`me` resolves to the caller), status, priority, due date or title. Returns a rollup in `meta.summary` computed over the whole filter, not just the page. Subtasks are excluded unless `includeSubtasks=true`.',
  })
  @ApiPaginatedEnvelopeResponse(TaskDto)
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Query() query: TaskListQueryDto,
  ): Promise<PaginatedResult<Task, TaskListMeta>> {
    return this.tasks.list(workspaceId, actor, query);
  }

  @Post()
  @Idempotent()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Create a task',
    description:
      'A `sectionId` implies its project. Pass `parentTaskId` to create a subtask; a subtask may have subtasks of its own, to any depth.',
  })
  @ApiEnvelopeResponse(TaskDto, { status: 201 })
  @ApiErrorResponseDoc(400, 'Section/project mismatch, or an unknown assignee')
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateTaskDto,
  ): Promise<Task> {
    return this.tasks.create(workspaceId, actor, dto);
  }

  @Get(':taskId')
  @ApiOperation({ summary: 'Get a task with its subtasks and context' })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDetailDto)
  @ApiErrorResponseDoc(404, 'No such task in this workspace')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskDetail> {
    return this.tasks.getDetail(workspaceId, taskId, actor);
  }

  @Get(':taskId/subtasks')
  @ApiOperation({
    summary: 'List the subtasks of a task',
    description:
      'The children of one task, in board order. Each is an ordinary task: complete or comment on one through `/tasks/{subtaskId}`. Needs only the parent’s id, unlike the project-scoped route the list view uses.',
  })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDto, { isArray: true })
  @ApiErrorResponseDoc(404, 'No such task in this workspace')
  subtasks(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<Task[]> {
    return this.tasks.listSubtasks(workspaceId, taskId, actor);
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
    @Actor() actor: ActorContext,
    @Body() dto: UpdateTaskDto,
  ): Promise<Task> {
    return this.tasks.update(workspaceId, actor, taskId, dto);
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
    @Actor() actor: ActorContext,
    @Body() dto: MoveTaskDto,
  ): Promise<Task> {
    return this.tasks.move(workspaceId, actor, taskId, dto);
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
    @Actor() actor: ActorContext,
  ): Promise<Task> {
    return this.tasks.archive(workspaceId, actor, taskId);
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
    @Actor() actor: ActorContext,
  ): Promise<Task> {
    return this.tasks.restore(workspaceId, actor, taskId);
  }

  @Post(':taskId/duplicate-of')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark a task as a duplicate of another',
    description: 'Completes it, links it to the original, and moves its collaborators there.',
  })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDetailDto)
  markDuplicate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
    @Body() dto: MarkDuplicateDto,
  ): Promise<TaskDetail> {
    return this.tasks.markDuplicate(workspaceId, actor, taskId, dto.taskId);
  }

  @Delete(':taskId/duplicate-of')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop marking a task as a duplicate' })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDetailDto)
  clearDuplicate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskDetail> {
    return this.tasks.clearDuplicate(workspaceId, actor, taskId);
  }

  @Post(':taskId/projects')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Add a task to another project',
    description: 'Multi-homing: the task keeps its home and appears in this project too.',
  })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDetailDto)
  addToProject(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
    @Body() dto: AddTaskToProjectDto,
  ): Promise<TaskDetail> {
    return this.taskProjects.add(workspaceId, actor, taskId, dto);
  }

  @Patch(':taskId/projects/:projectId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({ summary: "Change the task's section in one of its projects" })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiEnvelopeResponse(TaskDetailDto)
  setProjectSection(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: SetTaskProjectSectionDto,
  ): Promise<TaskDetail> {
    return this.taskProjects.setSection(workspaceId, actor, taskId, projectId, dto.sectionId);
  }

  @Delete(':taskId/projects/:projectId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a task from one of its projects',
    description:
      'Leaving its home, the project it joined first becomes its home. Returns the task, or null if the caller can no longer see it.',
  })
  @ApiParam({ name: 'taskId', format: 'uuid' })
  @ApiParam({ name: 'projectId', format: 'uuid' })
  removeFromProject(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskDetail | null> {
    return this.taskProjects.remove(workspaceId, actor, taskId, projectId);
  }
}
