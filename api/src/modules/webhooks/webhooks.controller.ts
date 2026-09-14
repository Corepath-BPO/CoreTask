import { WorkspaceRole } from '@coretask/contracts';
import type {
  CreatedWebhookEndpoint,
  WebhookDelivery,
  WebhookDeliveryDetail,
  WebhookDeliveryPage,
  WebhookEndpoint,
  WebhookSecretRotation,
  WebhookTestResult,
} from '@coretask/types';
import {
  createWebhookSchema,
  updateWebhookSchema,
  webhookDeliveryQuerySchema,
} from '@coretask/validation';
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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  ApiEnvelopeResponse,
  ApiErrorResponseDoc,
} from '../../common/decorators/api-envelope.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SessionOnly } from '../../common/decorators/session-only.decorator';
import { RequireWorkspaceRole } from '../../common/decorators/workspace.decorator';
import { parseBody } from '../../common/utils/zod-body.util';
import { WorkspaceMemberGuard } from '../workspace-members/workspace-member.guard';

import {
  CreatedWebhookEndpointDto,
  WebhookDeliveryDetailDto,
  WebhookDeliveryDto,
  WebhookDeliveryPageDto,
  WebhookEndpointDto,
  WebhookSecretRotationDto,
  WebhookTestResultDto,
} from './dto/webhook-response.dto';
import { WebhooksService } from './webhooks.service';

/**
 * An endpoint receives everything that happens in the workspace, so managing
 * them is workspace administration — ADMIN and above, and never an API key.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/webhooks')
@UseGuards(WorkspaceMemberGuard)
@RequireWorkspaceRole(WorkspaceRole.ADMIN)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not an administrator of this workspace, or the caller is an API key')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @ApiOperation({ summary: 'List webhook endpoints' })
  @ApiEnvelopeResponse(WebhookEndpointDto, { isArray: true })
  list(@Param('workspaceId', ParseUUIDPipe) workspaceId: string): Promise<WebhookEndpoint[]> {
    return this.webhooks.list(workspaceId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Add a webhook endpoint',
    description:
      'The signing secret is in this response and nowhere else afterwards. Deliveries carry `X-CoreTask-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.',
  })
  @ApiEnvelopeResponse(CreatedWebhookEndpointDto, { status: 201 })
  @ApiErrorResponseDoc(404, 'The project is not in this workspace')
  @ApiErrorResponseDoc(409, 'The workspace already has the maximum number of endpoints')
  @ApiErrorResponseDoc(422, 'Validation failed, or the URL points somewhere CoreTask may not call')
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ): Promise<CreatedWebhookEndpoint> {
    const input = parseBody(createWebhookSchema, body, 'The webhook is invalid.');
    return this.webhooks.create(workspaceId, userId, input);
  }

  @Get(':endpointId')
  @ApiOperation({ summary: 'Get one webhook endpoint' })
  @ApiParam({ name: 'endpointId', format: 'uuid' })
  @ApiEnvelopeResponse(WebhookEndpointDto)
  @ApiErrorResponseDoc(404, 'No such endpoint in this workspace')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
  ): Promise<WebhookEndpoint> {
    return this.webhooks.get(workspaceId, endpointId);
  }

  @Patch(':endpointId')
  @ApiOperation({
    summary: 'Change a webhook endpoint',
    description: 'Re-enabling clears the failure count and the auto-disable reason.',
  })
  @ApiParam({ name: 'endpointId', format: 'uuid' })
  @ApiEnvelopeResponse(WebhookEndpointDto)
  @ApiErrorResponseDoc(404, 'No such endpoint in this workspace')
  @ApiErrorResponseDoc(422, 'Validation failed, or the URL points somewhere CoreTask may not call')
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @CurrentUser('id') userId: string,
    @Body() body: unknown,
  ): Promise<WebhookEndpoint> {
    const input = parseBody(updateWebhookSchema, body, 'The change is invalid.');
    return this.webhooks.update(workspaceId, userId, endpointId, input);
  }

  @Delete(':endpointId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a webhook endpoint', description: 'Its deliveries go with it.' })
  @ApiParam({ name: 'endpointId', format: 'uuid' })
  @ApiErrorResponseDoc(404, 'No such endpoint in this workspace')
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.webhooks.remove(workspaceId, userId, endpointId);
  }

  @Post(':endpointId/rotate-secret')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate the signing secret',
    description: 'The previous secret stops verifying immediately; update the receiver first.',
  })
  @ApiParam({ name: 'endpointId', format: 'uuid' })
  @ApiEnvelopeResponse(WebhookSecretRotationDto)
  @ApiErrorResponseDoc(404, 'No such endpoint in this workspace')
  rotateSecret(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @CurrentUser('id') userId: string,
  ): Promise<WebhookSecretRotation> {
    return this.webhooks.rotateSecret(workspaceId, userId, endpointId);
  }

  @Post(':endpointId/test')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Send a test event',
    description: 'Queues a `ping` delivery. Its outcome appears in the deliveries list.',
  })
  @ApiParam({ name: 'endpointId', format: 'uuid' })
  @ApiEnvelopeResponse(WebhookTestResultDto, { status: 202 })
  @ApiErrorResponseDoc(400, 'The endpoint is disabled')
  @ApiErrorResponseDoc(404, 'No such endpoint in this workspace')
  test(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('endpointId', ParseUUIDPipe) endpointId: string,
    @CurrentUser('id') userId: string,
  ): Promise<WebhookTestResult> {
    return this.webhooks.test(workspaceId, userId, endpointId);
  }
}

/**
 * One flat list for the whole workspace, filterable by endpoint or rule: a
 * rule can send to an ad-hoc URL, and those deliveries belong to no endpoint.
 */
@ApiTags('Integrations')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/webhook-deliveries')
@UseGuards(WorkspaceMemberGuard)
@RequireWorkspaceRole(WorkspaceRole.ADMIN)
@SessionOnly()
@ApiParam({ name: 'workspaceId', format: 'uuid' })
@ApiErrorResponseDoc(401, 'Missing or invalid access token')
@ApiErrorResponseDoc(403, 'Not an administrator of this workspace, or the caller is an API key')
export class WebhookDeliveriesController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Get()
  @ApiOperation({
    summary: 'List deliveries',
    description: 'Newest first. `before` is an id cursor from the previous page.',
  })
  @ApiQuery({ name: 'endpointId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'ruleId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'before', required: false, format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiEnvelopeResponse(WebhookDeliveryPageDto)
  @ApiErrorResponseDoc(422, 'Invalid filter')
  list(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<WebhookDeliveryPage> {
    const input = parseBody(webhookDeliveryQuerySchema, query, 'The filter is invalid.');
    return this.webhooks.listDeliveries(workspaceId, input);
  }

  @Get(':deliveryId')
  @ApiOperation({ summary: 'Get one delivery, with its payload and attempt history' })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiEnvelopeResponse(WebhookDeliveryDetailDto)
  @ApiErrorResponseDoc(404, 'No such delivery in this workspace')
  get(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ): Promise<WebhookDeliveryDetail> {
    return this.webhooks.getDelivery(workspaceId, deliveryId);
  }

  @Post(':deliveryId/redeliver')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Deliver again',
    description:
      'Queues the same payload again and keeps the attempt history. Only for deliveries that have settled.',
  })
  @ApiParam({ name: 'deliveryId', format: 'uuid' })
  @ApiEnvelopeResponse(WebhookDeliveryDto, { status: 202 })
  @ApiErrorResponseDoc(400, 'The endpoint is disabled')
  @ApiErrorResponseDoc(404, 'No such delivery in this workspace')
  @ApiErrorResponseDoc(409, 'The delivery is still being attempted')
  redeliver(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ): Promise<WebhookDelivery> {
    return this.webhooks.redeliver(workspaceId, deliveryId);
  }
}
