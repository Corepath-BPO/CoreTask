import { ActivityEntity } from '@coretask/contracts';
import type { ActivityEntry, ItemActivityPage } from '@coretask/types';
import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { ActivityLogsService } from './activity-logs.service';
import {
  ActivityEntryDto,
  ActivityQueryDto,
  ItemActivityPageDto,
  ItemActivityQueryDto,
} from './dto/activity.dto';

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

  /*
   * Declared before the bare feed so `item` is never read as a parameter. The
   * feed takes no path parameter today, but the order costs nothing and
   * outlives that.
   *
   * Under the workspace rather than under `/tasks/:id`: the trail carries the
   * workspace on every line, so `{ workspaceId, entity, entityId }` is
   * tenant-safe without resolving the item — and resolving it would drag the
   * task and ticket modules into a module every one of them imports.
   */
  @Get('item')
  @ApiOperation({
    summary: 'One task’s or ticket’s stories',
    description:
      'Newest first, paged by cursor. Comment stories are left out because the thread shows the comments themselves.',
  })
  @ApiEnvelopeResponse(ItemActivityPageDto)
  @ApiErrorResponseDoc(422, 'Validation failed')
  listForItem(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Query() query: ItemActivityQueryDto,
  ): Promise<ItemActivityPage> {
    return this.activity.listForEntity(
      workspaceId,
      actor,
      query.entity === 'TASK' ? ActivityEntity.TASK : ActivityEntity.TICKET,
      query.entityId,
      { before: query.before, limit: query.limit },
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Recent workspace activity',
    description: 'Newest first. Capped rather than paged — this is a feed, not an archive.',
  })
  @ApiEnvelopeResponse(ActivityEntryDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Query() query: ActivityQueryDto,
  ): Promise<ActivityEntry[]> {
    return this.activity.listFeed(workspaceId, actor, query.limit);
  }
}
