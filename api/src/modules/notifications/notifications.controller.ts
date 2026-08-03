import type { NotificationFeed } from '@coretask/types';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  MarkNotificationsReadDto,
  MarkNotificationsReadResultDto,
  NotificationFeedDto,
  NotificationQueryDto,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * An inbox belongs to one person, so every query is scoped by the caller's id as
 * well as the workspace. Membership alone must never expose another member's
 * notifications, and the route carries no user id to tamper with.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/notifications')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'The caller’s notifications for this workspace',
    description: 'Newest first. `unreadCount` covers the workspace, not just the returned page.',
  })
  @ApiEnvelopeResponse(NotificationFeedDto)
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Query() query: NotificationQueryDto,
  ): Promise<NotificationFeed> {
    return this.notifications.feed(userId, workspaceId, query.limit);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark notifications as read',
    description: 'Pass `notificationIds` for specific entries, or omit it to clear the inbox.',
  })
  @ApiEnvelopeResponse(MarkNotificationsReadResultDto)
  markRead(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: MarkNotificationsReadDto,
  ): Promise<{ updated: number; unreadCount: number }> {
    return this.notifications.markRead(userId, workspaceId, dto.notificationIds);
  }
}
