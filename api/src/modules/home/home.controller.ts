import type { HomeLayout } from '@coretask/types';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { Actor } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { UpdateHomeLayoutDto } from './dto/home.dto';
import { HomeService } from './home.service';

@ApiTags('Home')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/home')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  @Get()
  @ApiOperation({ summary: 'The caller’s Home: its widgets, in order, and their notepad' })
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<HomeLayout> {
    return this.home.get(workspaceId, actor);
  }

  @Put()
  @ApiOperation({ summary: 'Rearrange the caller’s Home, or save their notepad' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
    @Body() dto: UpdateHomeLayoutDto,
  ): Promise<HomeLayout> {
    return this.home.update(workspaceId, actor, dto);
  }

  @Delete()
  @ApiOperation({ summary: 'Put the caller’s Home back to the default widgets' })
  reset(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<HomeLayout> {
    return this.home.reset(workspaceId, actor);
  }
}
