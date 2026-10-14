import type { Tag, TagRef } from '@coretask/types';
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

import { AddTaskTagDto, CreateTagDto, UpdateTagDto } from './dto/tag.dto';
import { TagsService } from './tags.service';

@ApiTags('Tags')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tags')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @ApiOperation({ summary: "The workspace's tags, with how many tasks carry each" })
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<Tag[]> {
    return this.tags.list(workspaceId);
  }

  @Post()
  @ApiOperation({ summary: 'Make a tag' })
  @ApiErrorResponseDoc(409, 'A tag with that name already exists')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CreateTagDto,
  ): Promise<Tag> {
    return this.tags.create(workspaceId, actor, dto);
  }

  @Patch(':tagId')
  @ApiParam({ name: 'tagId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename or recolour a tag' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateTagDto,
  ): Promise<Tag> {
    return this.tags.update(workspaceId, actor, tagId, dto);
  }

  @Delete(':tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'tagId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a tag (its maker, or a manager); it leaves every task' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.tags.remove(workspaceId, actor, tagId);
  }
}

@ApiTags('Tags')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tasks/:taskId/tags')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'taskId', format: 'uuid' })
@ApiErrorResponseDoc(404, 'The task is not visible to the caller')
export class TaskTagsController {
  constructor(private readonly tags: TagsService) {}

  @Post()
  @ApiOperation({
    summary: 'Tag a task',
    description: 'Answers with the task’s tags as they now are.',
  })
  add(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Actor() actor: ActorContext,
    @Body() dto: AddTaskTagDto,
  ): Promise<TagRef[]> {
    return this.tags.addToTask(workspaceId, actor, taskId, dto);
  }

  @Delete(':tagId')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'tagId', format: 'uuid' })
  @ApiOperation({ summary: 'Take a tag off a task' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('tagId', ParseUUIDPipe) tagId: string,
    @Actor() actor: ActorContext,
  ): Promise<TagRef[]> {
    return this.tags.removeFromTask(workspaceId, actor, taskId, tagId);
  }
}
