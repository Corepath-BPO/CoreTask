import { WorkspaceRole } from '@coretask/contracts';
import type {
  SlackChannel,
  SlackInstallResult,
  SlackInstallUrl,
  SlackLinkPreview,
  SlackLinkResult,
  SlackStatus,
} from '@coretask/types';
import { completeSlackInstallSchema, slackLinkSchema } from '@coretask/validation';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ApiErrorResponseDoc } from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { Actor, RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import type { ActorContext } from '../../common/types/api.types';
import { parseBody } from '../../common/utils/zod-body.util';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import { SlackSignatureGuard } from './slack-signature.guard';
import {
  SlackInteractionsService,
  type Interaction,
  type SlackReply,
  type SlashCommand,
} from './slack-interactions.service';
import { SlackService } from './slack.service';

/** Integrations › Slack: the workspace's install, and the viewer's own link. */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/slack')
@UseGuards(WorkspaceMemberGuard)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
export class SlackController {
  constructor(private readonly slack: SlackService) {}

  @Get()
  @ApiOperation({ summary: 'Whether Slack is set up, connected, and linked for you' })
  status(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<SlackStatus> {
    return this.slack.status(workspaceId, actor);
  }

  @Post('install')
  @HttpCode(HttpStatus.OK)
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Start installing the Slack app',
    description:
      'Answers the Slack address to send the browser to. Slack sends it back to the web app’s `/integrations/slack/callback`, which finishes with `POST /integrations/slack/install`.',
  })
  @ApiErrorResponseDoc(400, 'This server has no Slack app set up')
  install(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
  ): SlackInstallUrl {
    return this.slack.installUrl(workspaceId, userId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequireWorkspaceRole(WorkspaceRole.ADMIN)
  @ApiOperation({
    summary: 'Disconnect Slack',
    description:
      'Removes the app from the Slack workspace and forgets every linked account. Channels the app posted to switch off.',
  })
  async disconnect(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Actor() actor: ActorContext,
  ): Promise<void> {
    await this.slack.disconnect(workspaceId, actor);
  }

  @Get('channels')
  @RequireWorkspaceRole(WorkspaceRole.MEMBER)
  @ApiOperation({ summary: 'Channels the Slack app can post to' })
  @ApiErrorResponseDoc(404, 'Slack is not connected')
  channels(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<SlackChannel[]> {
    return this.slack.channels(workspaceId);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlink your Slack account' })
  async unlink(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    await this.slack.unlinkMe(workspaceId, userId);
  }
}

/**
 * Pages Slack sends people to, posting back with their session: finishing an
 * install, and linking a Slack account.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('integrations/slack')
@SessionOnly()
export class SlackAccountController {
  constructor(private readonly slack: SlackService) {}

  @Post('install')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish installing the Slack app with the code Slack sent back' })
  @ApiErrorResponseDoc(400, 'The install link is invalid, expired, or someone else’s')
  @ApiErrorResponseDoc(409, 'That Slack workspace is connected to another CoreTask workspace')
  complete(@CurrentUser('id') userId: string, @Body() body: unknown): Promise<SlackInstallResult> {
    return this.slack.completeInstall(
      userId,
      parseBody(completeSlackInstallSchema, body, 'Slack sent an incomplete answer.'),
    );
  }

  @Post('link/preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Say what a Slack account link would do' })
  preview(@CurrentUser('id') userId: string, @Body() body: unknown): Promise<SlackLinkPreview> {
    const { token } = parseBody(slackLinkSchema, body, 'The link is incomplete.');
    return this.slack.previewLink(userId, token);
  }

  @Post('link')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Link a Slack account to you' })
  link(@CurrentUser('id') userId: string, @Body() body: unknown): Promise<SlackLinkResult> {
    const { token } = parseBody(slackLinkSchema, body, 'The link is incomplete.');
    return this.slack.link(userId, token);
  }
}

/**
 * Slack's side: the slash command and every interaction. Signed by Slack,
 * not signed in, and answered in Slack's shapes rather than the envelope —
 * Slack shows the body of the 200 to the person, or reads it as what to do
 * with the modal.
 */
@ApiTags('Integrations')
@Controller('integrations/slack')
@Public()
@SkipThrottle()
@UseGuards(SlackSignatureGuard)
export class SlackEventsController {
  private readonly logger = new Logger(SlackEventsController.name);

  constructor(private readonly interactions: SlackInteractionsService) {}

  @Post('commands')
  @ApiExcludeEndpoint()
  @ApiConsumes('application/x-www-form-urlencoded')
  async command(@Req() request: Request, @Res() response: Response): Promise<void> {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const command: SlashCommand = {
      team_id: text(body['team_id']),
      user_id: text(body['user_id']),
      channel_id: text(body['channel_id']),
      text: text(body['text']),
      trigger_id: text(body['trigger_id']),
    };
    reply(response, await this.interactions.command(command));
  }

  @Post('interactions')
  @ApiExcludeEndpoint()
  @ApiConsumes('application/x-www-form-urlencoded')
  async interaction(@Req() request: Request, @Res() response: Response): Promise<void> {
    const raw = text((request.body as Record<string, unknown> | undefined)?.['payload']);
    let payload: Interaction;
    try {
      payload = JSON.parse(raw ?? '') as Interaction;
    } catch {
      this.logger.warn('A signed Slack interaction had no readable payload');
      response.status(HttpStatus.BAD_REQUEST).end();
      return;
    }
    reply(response, await this.interactions.interaction(payload));
  }
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** A 200 either way: an empty one is Slack's "received". */
function reply(response: Response, body: SlackReply): void {
  if (body) response.status(HttpStatus.OK).json(body);
  else response.status(HttpStatus.OK).end();
}
