import type { WorkspaceRole } from '@coretask/contracts';
import type { CreatedWebhookSubscription, WebhookSubscription } from '@coretask/types';
import { createWebhookSubscriptionSchema } from '@coretask/validation';
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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AllowedForReadScope } from '../../common/decorators/read-scope.decorator';
import { CurrentWorkspace } from '../../common/decorators/workspace.decorator';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { parseBody } from '../../common/utils/zod-body.util';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  CreatedWebhookSubscriptionDto,
  WebhookSubscriptionDto,
} from './dto/webhook-subscription.dto';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';

/**
 * REST hooks for connectors. An API key or an OAuth app subscribes a URL to a
 * project's events when someone turns a trigger on, and deletes it when they
 * turn it off; it sees and removes only its own.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('workspaces/:workspaceId/webhook-subscriptions')
@UseGuards(WorkspaceMemberGuard)
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid credential')
@ApiErrorResponseDoc(403, 'Called with a person’s session: people add webhooks in Settings')
export class WebhookSubscriptionsController {
  constructor(private readonly subscriptions: WebhookSubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'List this integration’s webhook subscriptions' })
  @ApiEnvelopeResponse(WebhookSubscriptionDto, { isArray: true })
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<WebhookSubscription[]> {
    return this.subscriptions.list(workspaceId, principal);
  }

  @Post()
  // Subscribing listens; it changes nobody's work, so a read-only app may.
  @AllowedForReadScope()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Subscribe to a project’s events',
    description:
      'Deliveries are POSTs signed like every CoreTask webhook: `X-CoreTask-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`, with the secret in this response and nowhere else. A project the caller cannot see is a 404, and deliveries stop if the caller later loses access to it.',
  })
  @ApiEnvelopeResponse(CreatedWebhookSubscriptionDto, { status: 201 })
  @ApiErrorResponseDoc(404, 'No such project, or one the caller cannot see')
  @ApiErrorResponseDoc(409, 'The integration already has the maximum number of subscriptions')
  @ApiErrorResponseDoc(422, 'Validation failed, or the URL points somewhere CoreTask may not call')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser() principal: AuthenticatedUser,
    @CurrentWorkspace('role') role: string,
    @Body() body: unknown,
  ): Promise<CreatedWebhookSubscription> {
    const input = parseBody(createWebhookSubscriptionSchema, body, 'The subscription is invalid.');
    return this.subscriptions.create(workspaceId, principal, role as WorkspaceRole, input);
  }

  @Get(':subscriptionId')
  @ApiOperation({ summary: 'Get one of this integration’s webhook subscriptions' })
  @ApiParam({ name: 'subscriptionId', format: 'uuid' })
  @ApiEnvelopeResponse(WebhookSubscriptionDto)
  @ApiErrorResponseDoc(404, 'No such subscription of this integration')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<WebhookSubscription> {
    return this.subscriptions.get(workspaceId, principal, subscriptionId);
  }

  @Delete(':subscriptionId')
  @AllowedForReadScope()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unsubscribe' })
  @ApiParam({ name: 'subscriptionId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'No such subscription of this integration')
  async remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @CurrentUser() principal: AuthenticatedUser,
  ): Promise<void> {
    await this.subscriptions.remove(workspaceId, principal, subscriptionId);
  }
}
