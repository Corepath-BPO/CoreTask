import type { SavedSearch } from '@coretask/types';
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

import { SaveSearchDto, UpdateSavedSearchDto } from './dto/search.dto';
import { SavedSearchesService } from './saved-searches.service';

@ApiTags('Search')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/saved-searches')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class SavedSearchesController {
  constructor(private readonly saved: SavedSearchesService) {}

  @Get()
  @ApiOperation({ summary: "The caller's saved searches" })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<SavedSearch[]> {
    return this.saved.list(workspaceId, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Save a search' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: SaveSearchDto,
  ): Promise<SavedSearch> {
    return this.saved.create(workspaceId, actor, dto);
  }

  @Patch(':searchId')
  @ApiParam({ name: 'searchId', format: 'uuid' })
  @ApiOperation({ summary: 'Rename a saved search or change its filters' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('searchId', ParseUUIDPipe) searchId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateSavedSearchDto,
  ): Promise<SavedSearch> {
    return this.saved.update(workspaceId, actor, searchId, dto);
  }

  @Delete(':searchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'searchId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a saved search' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('searchId', ParseUUIDPipe) searchId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.saved.remove(workspaceId, actor, searchId);
  }
}
