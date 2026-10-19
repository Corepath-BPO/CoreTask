import type { TeamMessage } from '@coretask/types';
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

import { TeamMessagesService } from './team-messages.service';

@ApiTags('Teams')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/teams/:teamId/messages')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiParam({ name: 'teamId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(404, 'No such team in this workspace')
export class TeamMessagesController {
  constructor(private readonly messages: TeamMessagesService) {}

  @Get()
  @ApiOperation({ summary: 'A team’s messages, newest first, with their replies' })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
  ): Promise<TeamMessage[]> {
    return this.messages.list(workspaceId, teamId);
  }

  @Post()
  @ApiOperation({ summary: 'Post a message to a team (its members, or a manager)' })
  post(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Actor() actor: ActorContext,
    @Body() dto: PostProjectMessageDto,
  ): Promise<TeamMessage> {
    return this.messages.post(workspaceId, teamId, actor, dto);
  }

  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a message (its author, or a manager)' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    return this.messages.remove(workspaceId, teamId, messageId, actor);
  }

  @Post(':messageId/replies')
  @ApiParam({ name: 'messageId', format: 'uuid' })
  @ApiOperation({ summary: 'Reply to a message', description: 'Returns the whole message.' })
  reply(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('teamId', ParseUUIDPipe) teamId: string,
    @Param('messageId', ParseUUIDPipe) messageId: string,
    @Actor() actor: ActorContext,
    @Body() dto: ReplyToMessageDto,
  ): Promise<TeamMessage> {
    return this.messages.reply(workspaceId, teamId, messageId, actor, dto.body);
  }
}
