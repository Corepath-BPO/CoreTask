import type { PortfolioMessage } from '@coretask/types';
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
import {
  PostProjectMessageDto,
  ReplyToMessageDto,
} from '../project-updates/dto/project-updates.dto';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { PortfolioMessagesService } from './portfolio-messages.service';

@ApiTags('Portfolios')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/portfolios/:portfolioId/messages')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'portfolioId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'No such portfolio in this workspace')
export class PortfolioMessagesController {
  constructor(private readonly messages: PortfolioMessagesService) {}

  @Get()
  @ApiOperation({ summary: 'A portfolio’s messages, newest first, with their replies' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Actor() actor: ActorContext,
  ): Promise<PortfolioMessage[]> {
    return this.messages.list(workspaceId, portfolioId, actor);
  }

  @Post()
  @ApiOperation({ summary: 'Post a message to a portfolio' })
  post(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Actor() actor: ActorContext,
    @Body() dto: PostProjectMessageDto,
  ): Promise<PortfolioMessage> {
    return this.messages.post(workspaceId, portfolioId, actor, dto);
  }

  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a message (its author, or a manager)' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.messages.remove(workspaceId, portfolioId, messageId, actor);
  }

  @Post(':messageId/replies')
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiOperation({ summary: 'Reply to a message', description: 'Returns the whole message.' })
  reply(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('portfolioId', ParseUUIDPipe) portfolioId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Actor() actor: ActorContext,
    @Body() dto: ReplyToMessageDto,
  ): Promise<PortfolioMessage> {
    return this.messages.reply(workspaceId, portfolioId, messageId, actor, dto.body);
  }
}
