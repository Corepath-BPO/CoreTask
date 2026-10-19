import { readTaskSearchFilters } from '@coretask/contracts';
import type { SearchResults, TaskSearchPage } from '@coretask/types';
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

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { RunTaskSearchDto, SearchQueryDto } from './dto/search.dto';
import { SearchService } from './search.service';
import { TaskSearchService } from './task-search.service';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/search')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'The caller is not a member of this workspace')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly taskSearch: TaskSearchService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Search the workspace',
    description:
      'Tasks, tickets, projects and people whose name contains the query, best match first within each kind. Archived work, and anything in a private project the caller is not on, is left out.',
  })
  @ApiErrorResponseDoc(400, 'Empty or over-long query, or an unknown kind')
  find(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Query() query: SearchQueryDto,
  ): Promise<SearchResults> {
    return this.search.search(workspaceId, actor, query.q, query.types, query.limit);
  }

  @Post('tasks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Advanced search over tasks',
    description:
      'Tasks matching every filter, among those the caller can see. With no status given, incomplete ones. At most 100 come back, with the full count.',
  })
  tasks(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: RunTaskSearchDto,
  ): Promise<TaskSearchPage> {
    return this.taskSearch.run(workspaceId, actor, readTaskSearchFilters(dto.filters), dto.today);
  }
}
