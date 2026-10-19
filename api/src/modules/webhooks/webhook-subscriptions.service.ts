import {
  ActivityAction,
  ActivityEntity,
  MAX_WEBHOOK_SUBSCRIPTIONS_PER_INTEGRATION,
  type SubscribableWebhookEvent,
  type WorkspaceRole,
} from '@coretask/contracts';
import type { CreatedWebhookSubscription, WebhookSubscription } from '@coretask/types';
import type { CreateWebhookSubscriptionInput } from '@coretask/validation';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../common/types/api.types';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { ProjectAccessService } from '../project-access/project-access.service';

import { deriveKey, encryptSecret, generateWebhookSecret } from './lib/secret-cipher';
import { assertDeliverableUrl } from './lib/url-policy';

const subscriptionSelect = {
  id: true,
  workspaceId: true,
  name: true,
  url: true,
  events: true,
  enabled: true,
  disabledReason: true,
  lastDeliveryAt: true,
  createdAt: true,
  project: { select: { id: true, name: true } },
} satisfies Prisma.WebhookEndpointSelect;

type SubscriptionRow = Prisma.WebhookEndpointGetPayload<{ select: typeof subscriptionSelect }>;

function toSubscriptionDto(row: SubscriptionRow): WebhookSubscription {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    // Always set: a subscription whose project was deleted is never listed.
    project: row.project as { id: string; name: string },
    name: row.name,
    url: row.url,
    events: row.events as SubscribableWebhookEvent[],
    enabled: row.enabled,
    disabledReason: row.disabledReason,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Which integration is asking: its API key or its OAuth grant. */
type Owner = { apiKeyId: string } | { oauthGrantId: string };

/**
 * Webhooks an integration subscribes through the API — the REST hooks that
 * Zapier, Make and n8n triggers register when someone turns one on, and
 * delete when it is turned off.
 *
 * Each watches one project its caller can see, and each belongs to the API key
 * or OAuth grant that made it: an integration sees and removes only its own,
 * and they go when the key is revoked or the app disconnected. Deliveries are
 * the same signed POSTs as an admin's endpoints, from the same worker.
 */
@Injectable()
export class WebhookSubscriptionsService {
  private readonly logger = new Logger(WebhookSubscriptionsService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly activity: ActivityLogsService,
    private readonly projectAccess: ProjectAccessService,
  ) {
    this.key = deriveKey(config.webhooks.encryptionKeyMaterial);
  }

  async list(workspaceId: string, principal: AuthenticatedUser): Promise<WebhookSubscription[]> {
    const rows = await this.prisma.webhookEndpoint.findMany({
      where: { workspaceId, projectId: { not: null }, ...ownerOf(principal) },
      select: subscriptionSelect,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSubscriptionDto);
  }

  async get(
    workspaceId: string,
    principal: AuthenticatedUser,
    subscriptionId: string,
  ): Promise<WebhookSubscription> {
    return toSubscriptionDto(await this.requireOwn(workspaceId, principal, subscriptionId));
  }

  /** The only response that carries the signing secret. */
  async create(
    workspaceId: string,
    principal: AuthenticatedUser,
    role: WorkspaceRole,
    input: CreateWebhookSubscriptionInput,
  ): Promise<CreatedWebhookSubscription> {
    const owner = ownerOf(principal);

    // A project the caller cannot see answers exactly as one that does not exist.
    const { project } = await this.projectAccess.resolveAccess(workspaceId, input.projectId, {
      userId: principal.id,
      role,
    });

    const count = await this.prisma.webhookEndpoint.count({ where: owner });
    if (count >= MAX_WEBHOOK_SUBSCRIPTIONS_PER_INTEGRATION) {
      throw AppException.conflict('WEBHOOK_SUBSCRIPTION_LIMIT_REACHED');
    }

    const url = assertDeliverableUrl(input.url, {
      allowPrivate: this.config.webhooks.allowPrivateUrls,
    });
    const integration = principal.oauth?.appName ?? principal.apiKey?.name ?? 'Integration';
    const secret = generateWebhookSecret();

    const row = await this.prisma.webhookEndpoint.create({
      data: {
        workspaceId,
        name: (input.name ?? `${integration} · ${project.name}`).slice(0, 80),
        url: url.toString(),
        secret: encryptSecret(secret, this.key),
        events: input.events,
        projectId: input.projectId,
        createdById: principal.id,
        ...owner,
      },
      select: subscriptionSelect,
    });

    await this.activity.record({
      workspaceId,
      actorId: principal.id,
      action: ActivityAction.CREATED,
      entity: ActivityEntity.WEBHOOK_ENDPOINT,
      entityId: row.id,
      // The host only: a hook URL often carries a path token nobody else should read.
      summary: `${integration} subscribed a webhook on "${project.name}" → ${url.host}`,
      metadata: { events: row.events, projectId: row.project?.id ?? null },
    });
    this.logger.log({ workspaceId, subscriptionId: row.id }, 'Webhook subscription created');

    return { subscription: toSubscriptionDto(row), secret };
  }

  async remove(
    workspaceId: string,
    principal: AuthenticatedUser,
    subscriptionId: string,
  ): Promise<void> {
    await this.requireOwn(workspaceId, principal, subscriptionId);
    await this.prisma.webhookEndpoint.delete({ where: { id: subscriptionId } });
    this.logger.log({ workspaceId, subscriptionId }, 'Webhook subscription deleted');
  }

  private async requireOwn(
    workspaceId: string,
    principal: AuthenticatedUser,
    subscriptionId: string,
  ): Promise<SubscriptionRow> {
    const row = await this.prisma.webhookEndpoint.findFirst({
      where: {
        id: subscriptionId,
        workspaceId,
        projectId: { not: null },
        ...ownerOf(principal),
      },
      select: subscriptionSelect,
    });
    if (!row) throw AppException.notFound('RESOURCE_NOT_FOUND', 'Webhook subscription not found.');
    return row;
  }
}

/**
 * The integration behind the request. A person's own session has none:
 * people manage webhooks in Settings, where they can see every one.
 */
function ownerOf(principal: AuthenticatedUser): Owner {
  if (principal.oauth) return { oauthGrantId: principal.oauth.grantId };
  if (principal.apiKey) return { apiKeyId: principal.apiKey.id };
  throw AppException.forbidden('INTEGRATION_ONLY');
}
