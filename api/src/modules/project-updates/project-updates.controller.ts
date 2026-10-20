import type {
  ProjectFile,
  ProjectMessage,
  ProjectStatusDraft,
  ProjectStatusUpdate,
  StatusRequestResult,
} from '@coretask/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  PostProjectMessageDto,
  PostStatusUpdateDto,
  ReplyToMessageDto,
} from './dto/project-updates.dto';
import { ProjectUpdatesService } from './project-updates.service';

/**
 * Status updates, messages and files.
 *
 * Under the workspace, with the project as a parameter, beside the one route
 * that spans projects — the newest status of each — so a static segment never
 * sits next to a UUID parameter.
 */
@ApiTags('Project updates')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not a member, or not allowed to post here')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class ProjectUpdatesController {
  constructor(private readonly updates: ProjectUpdatesService) {}

  @Get('status-updates/latest')
  @ApiOperation({
    summary: 'The newest status update of every visible project',
    description: 'What a project list, a portfolio and a project header show as its status.',
  })
  latest(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectStatusUpdate[]> {
    return this.updates.latestStatusUpdates(workspaceId, actor);
  }

  @Get('projects/:projectId/status-updates')
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'A project’s status updates, newest first' })
  listStatusUpdates(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectStatusUpdate[]> {
    return this.updates.listStatusUpdates(workspaceId, projectId, actor);
  }

  @Post('projects/:projectId/status-updates')
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({
    summary: 'Post a status update',
    description: 'Becomes the project’s status. The project’s members are notified.',
  })
  postStatusUpdate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: PostStatusUpdateDto,
  ): Promise<ProjectStatusUpdate> {
    return this.updates.postStatusUpdate(workspaceId, projectId, actor, dto);
  }

  @Post('projects/:projectId/status-updates/request')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({
    summary: 'Ask the project’s owner for a status update',
    description: 'Anyone who can see the project may ask; one ask an hour reaches the owner.',
  })
  requestStatusUpdate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<StatusRequestResult> {
    return this.updates.requestStatusUpdate(workspaceId, projectId, actor);
  }

  @Get('projects/:projectId/status-draft')
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({
    summary: 'The status update a rule’s AI step drafted, waiting to be posted',
    description:
      'Null when there is none. For those who may post an update. Posting any update clears it.',
  })
  getStatusDraft(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectStatusDraft | null> {
    return this.updates.getStatusDraft(workspaceId, projectId, actor);
  }

  @Delete('projects/:projectId/status-draft')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'Discard the drafted status update without posting it' })
  discardStatusDraft(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.updates.discardStatusDraft(workspaceId, projectId, actor);
  }

  @Delete('projects/:projectId/status-updates/:updateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'updateId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a status update (its author, or a manager)' })
  deleteStatusUpdate(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('updateId', ParseUUIDPipe) updateId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.updates.deleteStatusUpdate(workspaceId, projectId, updateId, actor);
  }

  @Get('projects/:projectId/messages')
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'A project’s messages, newest first, with their replies' })
  listMessages(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectMessage[]> {
    return this.updates.listMessages(workspaceId, projectId, actor);
  }

  @Post('projects/:projectId/messages')
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'Post a message to a project' })
  postMessage(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
    @Body() dto: PostProjectMessageDto,
  ): Promise<ProjectMessage> {
    return this.updates.postMessage(workspaceId, projectId, actor, dto);
  }

  @Delete('projects/:projectId/messages/:messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a message (its author, or a manager)' })
  deleteMessage(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.updates.deleteMessage(workspaceId, projectId, messageId, actor);
  }

  @Post('projects/:projectId/messages/:messageId/replies')
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiOperation({ summary: 'Reply to a message', description: 'Returns the whole message.' })
  reply(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Actor() actor: ActorContext,
    @Body() dto: ReplyToMessageDto,
  ): Promise<ProjectMessage> {
    return this.updates.reply(workspaceId, projectId, messageId, actor, dto.body);
  }

  @Get('projects/:projectId/files')
  @ApiParam({ name: 'projectId', format: 'uuid' })
  @ApiOperation({ summary: 'Every file attached to the project’s tasks, newest first' })
  listFiles(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Actor() actor: ActorContext,
  ): Promise<ProjectFile[]> {
    return this.updates.listFiles(workspaceId, projectId, actor);
  }
}
