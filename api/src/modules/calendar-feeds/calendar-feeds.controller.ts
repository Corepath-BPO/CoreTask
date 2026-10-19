import type { CalendarFeed } from '@coretask/types';
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
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiPropertyOptional,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';
import type { Response } from 'express';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { CalendarFeedsService } from './calendar-feeds.service';

export class CalendarFeedTargetDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'A project to follow; left out, the caller’s My Tasks.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  projectId?: string | null;
}

/**
 * The caller's own calendar links. Session-only: a link is a credential, and
 * an API key minting more of them would widen its own reach.
 */
@ApiTags('Calendar')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/calendar-feeds')
@UseGuards(WorkspaceMemberGuard)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'The project is not visible to the caller')
export class CalendarFeedsController {
  constructor(private readonly feeds: CalendarFeedsService) {}

  @Get()
  @ApiOperation({ summary: 'The caller’s calendar link for My Tasks or a project, if any' })
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Query() query: CalendarFeedTargetDto,
  ): Promise<CalendarFeed | null> {
    return this.feeds.get(workspaceId, actor, query.projectId ?? null);
  }

  @Post()
  @ApiOperation({ summary: 'Make (or return) the caller’s calendar link' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CalendarFeedTargetDto,
  ): Promise<CalendarFeed> {
    return this.feeds.create(workspaceId, actor, dto.projectId ?? null);
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Replace the link; the old one stops working' })
  reset(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: CalendarFeedTargetDto,
  ): Promise<CalendarFeed> {
    return this.feeds.reset(workspaceId, actor, dto.projectId ?? null);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop syncing: the link stops working' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Query() query: CalendarFeedTargetDto,
  ): Promise<void> {
    return this.feeds.remove(workspaceId, actor, query.projectId ?? null);
  }
}

/**
 * The feed itself, which calendar apps fetch with no account: the secret in
 * the address is the whole of the authentication. Served raw, not in the JSON
 * envelope, because a calendar app reads iCalendar and nothing else.
 */
@ApiTags('Calendar')
@Controller('calendar')
export class CalendarFeedFileController {
  constructor(private readonly feeds: CalendarFeedsService) {}

  @Public()
  @Get(':file')
  @ApiOperation({ summary: 'A calendar link’s events, as iCalendar' })
  @ApiParam({ name: 'file', example: 'abc123.ics' })
  @ApiProduces('text/calendar')
  @ApiErrorResponseDoc(404, 'No such link, or its owner can no longer see it')
  async feed(@Param('file') file: string, @Res() res: Response): Promise<void> {
    const body = await this.feeds.render(file.replace(/\.ics$/i, ''));
    res
      .status(HttpStatus.OK)
      .set({
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="coretask.ics"',
        'Cache-Control': 'private, max-age=300',
      })
      .send(body);
  }
}
