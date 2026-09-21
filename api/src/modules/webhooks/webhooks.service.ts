import {
  ActivityAction,
  ActivityEntity,
  MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE,
  type WebhookDeliveryStatus,
} from '@coretask/contracts';
import type {
  CreatedWebhookEndpoint,
  WebhookDelivery as WebhookDeliveryDto,
  WebhookDeliveryDetail,
  WebhookDeliveryPage,
  WebhookEndpoint as WebhookEndpointDto,
  WebhookSecretRotation,
  WebhookTestResult,
} from '@coretask/types';
import type { CreateWebhookInput, UpdateWebhookInput } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';

import { deriveKey, encryptSecret, generateWebhookSecret } from './lib/secret-cipher';
import { assertDeliverableUrl } from './lib/url-policy';
import { WebhookDeliveryService } from './webhook-delivery.service';
import {
  deliveryDetailSelect,
  deliverySummarySelect,
  endpointInclude,
  toWebhookDeliveryDetailDto,
  toWebhookDeliveryDto,
  toWebhookEndpointDto,
} from './webhook.mapper';

interface DeliveryQuery {
  endpointId?: string | undefined;
  ruleId?: string | undefined;
  status?: string | undefined;
  before?: string | undefined;
  limit: number;
}

/** Request-side management of webhook endpoints; delivery itself lives in the worker. */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly activity: ActivityLogsService,
    private readonly deliveries: WebhookDeliveryService,
  ) {
    this.key = deriveKey(config.webhooks.encryptionKeyMaterial);
  }

  async list(workspaceId: string): Promise<WebhookEndpointDto[]> {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { workspaceId },
      include: endpointInclude,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toWebhookEndpointDto);
  }

  async get(workspaceId: string, endpointId: string): Promise<WebhookEndpointDto> {
    return toWebhookEndpointDto(await this.requireEndpoint(workspaceId, endpointId));
  }

  /** The only place the signing secret is returned besides `rotateSecret`. */
  async create(
    workspaceId: string,
    actorId: string,
    input: CreateWebhookInput,
  ): Promise<CreatedWebhookEndpoint> {
    await this.assertCapacity(workspaceId);
    const url = this.checkUrl(input.url);
    await this.assertProjectInWorkspace(workspaceId, input.projectId ?? null);

    const secret = input.secret ?? generateWebhookSecret();

    const row = await this.prisma.webhookEndpoint.create({
      data: {
        workspaceId,
        name: input.name,
        url: url.toString(),
        secret: encryptSecret(secret, this.key),
        events: input.events,
        projectId: input.projectId ?? null,
        enabled: input.enabled ?? true,
        createdById: actorId,
      },
      include: endpointInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.WEBHOOK_ENDPOINT,
      entityId: row.id,
      // The host only: an n8n URL often carries a path token nobody else should read.
      summary: `Added webhook "${row.name}" → ${url.host}`,
      metadata: { events: row.events, projectId: row.projectId },
    });
    this.logger.log({ workspaceId, endpointId: row.id }, 'Webhook endpoint created');

    return { endpoint: toWebhookEndpointDto(row), secret };
  }

  async update(
    workspaceId: string,
    actorId: string,
    endpointId: string,
    input: UpdateWebhookInput,
  ): Promise<WebhookEndpointDto> {
    await this.requireEndpoint(workspaceId, endpointId);

    const url = input.url === undefined ? undefined : this.checkUrl(input.url);
    if (input.projectId !== undefined) {
      await this.assertProjectInWorkspace(workspaceId, input.projectId);
    }

    const row = await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(url ? { url: url.toString() } : {}),
        ...(input.events !== undefined ? { events: input.events } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        // Re-enabling is a fresh start: the failures that switched it off are history.
        ...(input.enabled === true ? { consecutiveFailures: 0, disabledReason: null } : {}),
      },
      include: endpointInclude,
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.WEBHOOK_ENDPOINT,
      entityId: row.id,
      summary: `Updated webhook "${row.name}"`,
      metadata: { enabled: row.enabled, events: row.events },
    });

    return toWebhookEndpointDto(row);
  }

  /** Hard delete: its deliveries go with it, and nothing else points at an endpoint. */
  async remove(workspaceId: string, actorId: string, endpointId: string): Promise<void> {
    const existing = await this.requireEndpoint(workspaceId, endpointId);

    await this.prisma.webhookEndpoint.delete({ where: { id: endpointId } });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.DELETED,
      entity: ActivityEntity.WEBHOOK_ENDPOINT,
      entityId: endpointId,
      summary: `Removed webhook "${existing.name}"`,
    });
  }

  /** The old secret stops verifying at once, so the receiver must be updated before deliveries resume. */
  async rotateSecret(
    workspaceId: string,
    actorId: string,
    endpointId: string,
  ): Promise<WebhookSecretRotation> {
    const existing = await this.requireEndpoint(workspaceId, endpointId);
    const secret = generateWebhookSecret();

    await this.prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { secret: encryptSecret(secret, this.key) },
    });

    await this.activity.record({
      workspaceId,
      actorId,
      action: ActivityAction.UPDATED,
      entity: ActivityEntity.WEBHOOK_ENDPOINT,
      entityId: endpointId,
      summary: `Rotated the signing secret of webhook "${existing.name}"`,
    });

    return { secret };
  }

  /** Queues a `ping`; the result shows up in the deliveries list like any other. */
  async test(workspaceId: string, actorId: string, endpointId: string): Promise<WebhookTestResult> {
    const endpoint = await this.requireEndpoint(workspaceId, endpointId);

    if (!endpoint.enabled) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Enable the endpoint before sending it a test event.',
      );
    }

    const deliveryId = await this.deliveries.createPing(endpoint, actorId);
    return { deliveryId };
  }

  /** Newest first; `before` is an id cursor, ids being UUID v7 and therefore time-ordered. */
  async listDeliveries(workspaceId: string, query: DeliveryQuery): Promise<WebhookDeliveryPage> {
    const rows = await this.prisma.webhookDelivery.findMany({
      where: {
        workspaceId,
        ...(query.endpointId ? { endpointId: query.endpointId } : {}),
        ...(query.ruleId ? { ruleId: query.ruleId } : {}),
        ...(query.status ? { status: query.status as WebhookDeliveryStatus } : {}),
        ...(query.before ? { id: { lt: query.before } } : {}),
      },
      orderBy: { id: 'desc' },
      take: query.limit + 1,
      select: deliverySummarySelect,
    });

    const hasMore = rows.length > query.limit;
    const items = rows.slice(0, query.limit);

    return {
      items: items.map(toWebhookDeliveryDto),
      hasMore,
      nextBefore: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }

  async getDelivery(workspaceId: string, deliveryId: string): Promise<WebhookDeliveryDetail> {
    const row = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, workspaceId },
      select: deliveryDetailSelect,
    });

    if (!row) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Delivery not found.');
    }

    return toWebhookDeliveryDetailDto(row);
  }

  /**
   * A delivery tried again by hand — once the receiver has been fixed, say.
   * Only a settled one: a pending delivery already has a job waiting on it.
   */
  async redeliver(workspaceId: string, deliveryId: string): Promise<WebhookDeliveryDto> {
    const row = await this.prisma.webhookDelivery.findFirst({
      where: { id: deliveryId, workspaceId },
      select: { id: true, status: true, endpointId: true, endpoint: { select: { enabled: true } } },
    });

    if (!row) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Delivery not found.');
    }
    if (row.status === 'PENDING') {
      throw AppException.conflict('RESOURCE_CONFLICT', 'This delivery is still being attempted.');
    }
    if (row.endpointId !== null && !row.endpoint?.enabled) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'Enable the endpoint before redelivering to it.',
      );
    }

    await this.deliveries.redeliver(row.id);

    const updated = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: row.id },
      select: deliverySummarySelect,
    });
    return toWebhookDeliveryDto(updated);
  }

  private checkUrl(raw: string): URL {
    return assertDeliverableUrl(raw, { allowPrivate: this.config.webhooks.allowPrivateUrls });
  }

  private async assertCapacity(workspaceId: string): Promise<void> {
    const count = await this.prisma.webhookEndpoint.count({ where: { workspaceId } });

    if (count >= MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE) {
      throw AppException.conflict('WEBHOOK_ENDPOINT_LIMIT_REACHED');
    }
  }

  private async assertProjectInWorkspace(
    workspaceId: string,
    projectId: string | null,
  ): Promise<void> {
    if (!projectId) return;

    const project = await this.prisma.project.findFirst({
      where: { id: projectId, workspaceId },
      select: { id: true },
    });

    if (!project) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Project not found in this workspace.');
    }
  }

  private async requireEndpoint(
    workspaceId: string,
    endpointId: string,
  ): Promise<Prisma.WebhookEndpointGetPayload<{ include: typeof endpointInclude }>> {
    const row = await this.prisma.webhookEndpoint.findFirst({
      where: { id: endpointId, workspaceId },
      include: endpointInclude,
    });

    if (!row) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'Webhook endpoint not found.');
    }

    return row;
  }
}
