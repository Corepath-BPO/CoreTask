import type { ActivityEntry } from '@coretask/types';
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ActivityLogsService } from './activity-logs.service';
import { ActivityEntryDto, ActivityQueryDto } from './dto/activity.dto';

/**
 * Read-only by design: the trail is written as a side effect of the actions it
 * records, so there is no endpoint that can forge or amend a line.
 */
@ApiTags('Activity')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/activity')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class ActivityLogsController {
  constructor(private readonly activity: ActivityLogsService) {}

  @Get()
  @ApiOperation({
    summary: 'Recent workspace activity',
    description: 'Newest first. Capped rather than paged — this is a feed, not an archive.',
  })
  @ApiEnvelopeResponse(ActivityEntryDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityEntry[]> {
    return this.activity.listFeed(workspaceId, query.limit);
  }
}
