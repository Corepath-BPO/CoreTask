import type { TaskTime } from '@coretask/types';
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

import { LogTimeDto, UpdateTimeEntryDto } from './dto/time-entry.dto';
import { TimeEntriesService } from './time-entries.service';

@ApiTags('Tasks')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tasks/:taskId/time-entries')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'taskId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'The task is not visible to the caller')
export class TimeEntriesController {
  constructor(private readonly time: TimeEntriesService) {}

  @Get()
  @ApiOperation({ summary: 'Time logged against a task, and its total' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskTime> {
    return this.time.list(workspaceId, taskId, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Log time against a task' })
  log(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
    @Body() dto: LogTimeDto,
  ): Promise<TaskTime> {
    return this.time.log(workspaceId, taskId, actor, dto);
  }

  @Patch(':entryId')
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiOperation({ summary: 'Change a time entry (its author, or a manager)' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateTimeEntryDto,
  ): Promise<TaskTime> {
    return this.time.update(workspaceId, taskId, entryId, actor, dto);
  }

  @Delete(':entryId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'entryId', format: 'uuid' })
  @ApiOperation({ summary: 'Remove a time entry (its author, or a manager)' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('entryId', ParseUUIDPipe) entryId: string,
    @Actor() actor: ActorContext,
  ): Promise<TaskTime> {
    return this.time.remove(workspaceId, taskId, entryId, actor);
  }
}
