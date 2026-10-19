import type { PortfolioStatusUpdate, StatusRequestResult } from '@coretask/types';
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
import { PostStatusUpdateDto } from '../project-updates/dto/project-updates.dto';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { PortfolioStatusService } from './portfolio-status.service';

@ApiTags('Portfolios')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/portfolios/:portfolioId/status-updates')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'portfolioId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'No such portfolio in this workspace')
export class PortfolioStatusController {
  constructor(private readonly statuses: PortfolioStatusService) {}

  @Get()
  @ApiOperation({ summary: 'A portfolio’s own status updates, newest first' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
  ): Promise<PortfolioStatusUpdate[]> {
    return this.statuses.list(workspaceId, portfolioId);
  }

  @Post()
  @ApiOperation({ summary: 'Set the portfolio’s status (its owner or a manager)' })
  @ApiErrorResponseDoc(403, 'Not the portfolio’s owner or a manager')
  post(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Actor() actor: ActorContext,
    @Body() dto: PostStatusUpdateDto,
  ): Promise<PortfolioStatusUpdate> {
    return this.statuses.post(workspaceId, portfolioId, actor, dto);
  }

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask the portfolio’s owner for a status update' })
  request(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Actor() actor: ActorContext,
  ): Promise<StatusRequestResult> {
    return this.statuses.request(workspaceId, portfolioId, actor);
  }

  @Delete(':updateId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a status update (its author or a manager)' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('updateId', ParseUUIDPipe) updateId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.statuses.remove(workspaceId, portfolioId, updateId, actor);
  }
}
