import { WorkspaceRole } from '@coretask/contracts';
import type { Comment } from '@coretask/types';
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
import {
  CurrentWorkspace,
  RequireWorkspaceRole,
} from '../../common/decorators/workspace.decorator';
import type { PaginatedResult } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { CommentsService } from './comments.service';
import { CommentDto, DeleteCommentResultDto } from './dto/comment-response.dto';
import { CommentListQueryDto, CreateCommentDto, UpdateCommentDto } from './dto/comment.dto';

/**
 * Threads live under the thing being discussed. Both parents are resolved
 * inside the workspace first, so a comment can never be attached to — or read
 * from — a task or ticket in someone else's tenant.
 */
@ApiTags('Comments')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tasks/:taskId/comments')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'taskId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class TaskCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @ApiOperation({ summary: 'List a task’s comments', description: 'Oldest first.' })
  @ApiPaginatedEnvelopeResponse(CommentDto)
  @ApiErrorResponseDoc(404, 'No such task in this workspace')
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Query() query: CommentListQueryDto,
  ): Promise<PaginatedResult<Comment>> {
    return this.comments.listForTask(workspaceId, taskId, query);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({ summary: 'Comment on a task' })
  @ApiEnvelopeResponse(CommentDto, { status: 201 })
  @ApiErrorResponseDoc(404, 'No such task in this workspace')
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCommentDto,
  ): Promise<Comment> {
    return this.comments.createForTask(workspaceId, userId, taskId, dto);
  }
}

@ApiTags('Comments')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/tickets/:idOrKey/comments')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'idOrKey', example: 'CORE-1001' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class TicketCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @ApiOperation({
    summary: 'List a ticket’s comments',
    description: 'Oldest first. The ticket may be addressed by UUID or by key.',
  })
  @ApiPaginatedEnvelopeResponse(CommentDto)
  @ApiErrorResponseDoc(404, 'No such ticket in this workspace')
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('idOrKey') idOrKey: string,
    @Query() query: CommentListQueryDto,
  ): Promise<PaginatedResult<Comment>> {
    return this.comments.listForTicket(workspaceId, idOrKey, query);
  }

  @Post()
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({ summary: 'Comment on a ticket' })
  @ApiEnvelopeResponse(CommentDto, { status: 201 })
  @ApiErrorResponseDoc(404, 'No such ticket in this workspace')
  @ApiErrorResponseDoc(422, 'Validation failed')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('idOrKey') idOrKey: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateCommentDto,
  ): Promise<Comment> {
    return this.comments.createForTicket(workspaceId, userId, idOrKey, dto);
  }
}

/**
 * Editing and deleting are addressed by comment id alone — it is unique, and
 * requiring the parent would only make the client remember where the comment
 * came from. Permission is per-comment, not per-route.
 */
@ApiTags('Comments')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/comments')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'commentId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Patch(':commentId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({
    summary: 'Edit a comment',
    description: 'Authors only, and only the body. Sets `editedAt`.',
  })
  @ApiEnvelopeResponse(CommentDto)
  @ApiErrorResponseDoc(403, 'Only the author can edit a comment')
  @ApiErrorResponseDoc(404, 'No such comment in this workspace')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCommentDto,
  ): Promise<Comment> {
    return this.comments.update(workspaceId, userId, commentId, dto);
  }

  @Delete(':commentId')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a comment',
    description:
      'Authors delete their own; MANAGER and above can remove anyone’s. Soft delete — activity entries keep pointing at the row.',
  })
  @ApiEnvelopeResponse(DeleteCommentResultDto)
  @ApiErrorResponseDoc(403, 'Not the author, and not a manager')
  @ApiErrorResponseDoc(404, 'No such comment in this workspace')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @CurrentUser('id') userId: string,
    @CurrentWorkspace('role') role: string,
  ): Promise<{ deleted: true }> {
    return this.comments.remove(workspaceId, userId, role as WorkspaceRole, commentId);
  }
}
