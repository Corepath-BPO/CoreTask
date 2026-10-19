import { NOTIFICATION_EMAIL_GROUPS, type NotificationEmailGroup } from '@coretask/contracts';
import type { NotificationPreferences } from '@coretask/types';
import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn } from 'class-validator';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { NotificationPreferencesService } from './notification-preferences.service';

export class UpdateNotificationPreferencesDto {
  @ApiProperty({ enum: NOTIFICATION_EMAIL_GROUPS, isArray: true })
  @IsArray()
  @ArrayMaxSize(NOTIFICATION_EMAIL_GROUPS.length)
  @IsIn(NOTIFICATION_EMAIL_GROUPS, { each: true })
  emailGroups!: NotificationEmailGroup[];
}

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/notification-preferences')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class NotificationPreferencesController {
  constructor(private readonly preferences: NotificationPreferencesService) {}

  @Get()
  @ApiOperation({ summary: 'Which notifications the caller also gets by email here' })
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<NotificationPreferences> {
    return this.preferences.get(workspaceId, actor.userId);
  }

  @Put()
  @ApiOperation({ summary: 'Choose which notifications also arrive by email' })
  set(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferences> {
    return this.preferences.set(workspaceId, actor.userId, dto.emailGroups);
  }
}
