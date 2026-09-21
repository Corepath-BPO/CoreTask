import { randomUUID } from 'node:crypto';

import {
  WEBHOOK_DELIVERY_HEADER,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_RESPONSE_SNIPPET_LENGTH,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_USER_AGENT,
  WEBHOOK_WORKSPACE_HEADER,
  WebhookDeliveryStatus,
  WebhookEventType,
  webhookEventTypeFor,
} from '@coretask/contracts';
import type { WebhookDeliveryAttempt, WebhookEventPayload } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, WebhookDelivery, WebhookEndpoint } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';

import { fetchWithTimeout, safeBody } from '../../common/utils/http.util';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import type { RuleWebhookRequest } from '../../jobs/queue-names';
import { WebhookQueue } from '../../jobs/webhook/webhook.queue';
import type { AutomationEvent } from '../automations/automation-event.publisher';

import { decryptSecret, deriveKey } from './lib/secret-cipher';
import { signWebhook } from './lib/signature';
import { assertResolvesToAllowedAddress } from './lib/url-policy';
import { WebhookPayloadBuilder } from './webhook-payload.builder';

type DeliveryWithEndpoint = WebhookDelivery & { endpoint: WebhookEndpoint | null };

interface AttemptResult {
  succeeded: boolean;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  snippet: string | null;
}

/**
 * Makes deliveries: expands an event into one row per subscribed endpoint,
 * then POSTs each row, recording every attempt.
 *
 * Retries are BullMQ's — this throws to ask for one and `UnrecoverableError`
 * to refuse one — so there is no retry loop here to disagree with the queue.
 */
@Injectable()
export class WebhookDeliveryService {
  private readonly logger = new Logger(WebhookDeliveryService.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly queue: WebhookQueue,
    private readonly payloads: WebhookPayloadBuilder,
  ) {
    this.key = deriveKey(config.webhooks.encryptionKeyMaterial);
  }

  /** One domain event → a pending delivery per endpoint that subscribed to it. */
  async fanOut(event: AutomationEvent): Promise<{ deliveries: number }> {
    const type = webhookEventTypeFor(event.trigger, event.entityType);
    if (!type) return { deliveries: 0 };

    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: {
        workspaceId: event.workspaceId,
        enabled: true,
        events: { has: type },
        OR: [{ projectId: null }, { projectId: event.projectId }],
      },
      select: { id: true, url: true },
    });
    if (endpoints.length === 0) return { deliveries: 0 };

    // Built once; every endpoint gets the same bytes.
    const payload = await this.payloads.build(event, type);

    for (const endpoint of endpoints) {
      // The unique (eventId, endpointId) makes a retried fan-out a no-op.
      const delivery = await this.prisma.webhookDelivery.upsert({
        where: { eventId_endpointId: { eventId: event.eventId, endpointId: endpoint.id } },
        create: {
          workspaceId: event.workspaceId,
          endpointId: endpoint.id,
          eventType: type,
          eventId: event.eventId,
          correlationId: event.correlationId ?? null,
          url: endpoint.url,
          payload: payload as unknown as Prisma.InputJsonValue,
          maxAttempts: this.config.webhooks.maxAttempts,
        },
        update: {},
        select: { id: true },
      });

      await this.queue.enqueueDelivery(delivery.id);
    }

    return { deliveries: endpoints.length };
  }

  /** A `ping`, so an admin can see the shape and check the receiver answers. Returns the delivery id. */
  async createPing(
    endpoint: Pick<WebhookEndpoint, 'id' | 'workspaceId' | 'url' | 'name'>,
    actorId: string | null,
  ): Promise<string> {
    const payload: WebhookEventPayload = {
      id: randomUUID(),
      type: WebhookEventType.PING,
      createdAt: new Date().toISOString(),
      workspaceId: endpoint.workspaceId,
      projectId: null,
      actor: await this.payloads.actor(actorId),
      causedByRuleId: null,
      correlationId: null,
      data: {
        endpointId: endpoint.id,
        name: endpoint.name,
        message: 'CoreTask can reach this endpoint. Real events look like this.',
      },
      changes: null,
    };

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        workspaceId: endpoint.workspaceId,
        endpointId: endpoint.id,
        eventType: payload.type,
        eventId: payload.id,
        url: endpoint.url,
        payload: payload as unknown as Prisma.InputJsonValue,
        maxAttempts: this.config.webhooks.maxAttempts,
      },
      select: { id: true },
    });

    await this.queue.enqueueDelivery(delivery.id);
    return delivery.id;
  }

  /**
   * A "Send a webhook" action's request, turned into a delivery.
   *
   * Registered endpoints are re-checked here — the rule may be older than the
   * endpoint's disabling — and the row carries the rule so the deliveries list
   * can be filtered by it. Ad-hoc URLs have no secret and go unsigned.
   */
  async ruleSend(request: RuleWebhookRequest): Promise<{ queued: boolean; reason?: string }> {
    let endpoint: { id: string; url: string; name: string } | null = null;

    if (request.endpointId) {
      const row = await this.prisma.webhookEndpoint.findFirst({
        where: { id: request.endpointId, workspaceId: request.workspaceId },
        select: { id: true, url: true, name: true, enabled: true },
      });
      if (!row) return { queued: false, reason: 'endpoint-missing' };
      if (!row.enabled) return { queued: false, reason: 'endpoint-disabled' };
      endpoint = row;
    }

    const [actor, task, rule] = await Promise.all([
      this.payloads.actor(request.actorId),
      this.payloads.task(request.workspaceId, request.entityId),
      this.prisma.automationRule.findUnique({
        where: { id: request.ruleId },
        select: { id: true, name: true },
      }),
    ]);

    const payload: WebhookEventPayload = {
      id: randomUUID(),
      type: WebhookEventType.AUTOMATION_WEBHOOK,
      createdAt: new Date().toISOString(),
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      actor,
      causedByRuleId: request.ruleId,
      correlationId: request.correlationId,
      data: {
        task,
        rule: { id: request.ruleId, name: rule?.name ?? null },
        trigger: request.trigger,
        extra: request.extra,
      },
      changes: null,
    };

    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        workspaceId: request.workspaceId,
        endpointId: endpoint?.id ?? null,
        ruleId: request.ruleId,
        eventType: payload.type,
        eventId: payload.id,
        correlationId: request.correlationId,
        url: endpoint?.url ?? request.url,
        payload: payload as unknown as Prisma.InputJsonValue,
        maxAttempts: this.config.webhooks.maxAttempts,
      },
      select: { id: true },
    });

    await this.queue.enqueueDelivery(delivery.id);
    return { queued: true };
  }

  /**
   * A delivery tried again from scratch, by hand.
   *
   * The attempt history stays — the row tells the whole story — while the
   * counter restarts so the new run gets its full quota of retries. Each
   * redelivery is a fresh job: the old job id may still be sitting in the
   * failed set, and BullMQ would ignore an add that reused it.
   */
  async redeliver(deliveryId: string): Promise<void> {
    await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: WebhookDeliveryStatus.PENDING,
        attempt: 0,
        responseStatus: null,
        responseBody: null,
        error: null,
        durationMs: null,
        nextAttemptAt: null,
        deliveredAt: null,
      },
    });

    await this.queue.enqueueDelivery(deliveryId, `-r${Date.now()}`);
  }

  /**
   * Drops settled deliveries older than the retention window. Pending rows
   * stay whatever their age: a job is still waiting on them.
   */
  async purgeExpired(now = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - this.config.webhooks.retentionDays * 86_400_000);
    const result = await this.prisma.webhookDelivery.deleteMany({
      where: { createdAt: { lt: cutoff }, status: { not: WebhookDeliveryStatus.PENDING } },
    });

    if (result.count > 0) {
      this.logger.log({ deleted: result.count }, 'Purged webhook deliveries past retention');
    }

    return { deleted: result.count };
  }

  /**
   * One attempt. Throws when the queue should try again, `UnrecoverableError`
   * when it should not (a 404 will not fix itself), and returns quietly when
   * there is nothing left to do.
   */
  async deliver(deliveryId: string, attempt: number): Promise<{ status: string }> {
    const delivery = await this.prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });

    if (!delivery) return { status: 'missing' };
    if (delivery.status === WebhookDeliveryStatus.SUCCEEDED) return { status: 'already-delivered' };

    if (delivery.endpointId !== null && (!delivery.endpoint || !delivery.endpoint.enabled)) {
      await this.settle(
        delivery,
        attempt,
        {
          succeeded: false,
          responseStatus: null,
          error: 'The endpoint is disabled or was deleted.',
          durationMs: null,
          snippet: null,
        },
        { final: true, countAgainstEndpoint: false },
      );
      return { status: 'endpoint-disabled' };
    }

    const body = JSON.stringify(delivery.payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': WEBHOOK_USER_AGENT,
      [WEBHOOK_EVENT_HEADER]: delivery.eventType,
      [WEBHOOK_EVENT_ID_HEADER]: delivery.eventId,
      [WEBHOOK_DELIVERY_HEADER]: delivery.id,
      [WEBHOOK_WORKSPACE_HEADER]: delivery.workspaceId,
    };
    // Ad-hoc rule sends have no endpoint and therefore no secret to sign with.
    if (delivery.endpoint) {
      const secret = decryptSecret(delivery.endpoint.secret, this.key);
      headers[WEBHOOK_SIGNATURE_HEADER] = signWebhook(secret, Math.floor(Date.now() / 1000), body);
    }

    const started = Date.now();
    let response: Response;

    try {
      const url = new URL(delivery.url);
      await assertResolvesToAllowedAddress(url, {
        allowPrivate: this.config.webhooks.allowPrivateUrls,
      });
      response = await fetchWithTimeout(
        url.toString(),
        { method: 'POST', headers, body, redirect: 'manual' },
        this.config.webhooks.timeoutMs,
        'The webhook endpoint',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A private address or a broken URL will not fix itself; a timeout might.
      const unrecoverable = /private address|Invalid URL/i.test(message);
      await this.settle(
        delivery,
        attempt,
        {
          succeeded: false,
          responseStatus: null,
          error: message,
          durationMs: Date.now() - started,
          snippet: null,
        },
        { final: unrecoverable || attempt >= delivery.maxAttempts, countAgainstEndpoint: true },
      );
      throw unrecoverable ? new UnrecoverableError(message) : error;
    }

    const durationMs = Date.now() - started;
    const snippet = await safeBody(response, WEBHOOK_RESPONSE_SNIPPET_LENGTH);

    if (response.ok) {
      await this.settle(
        delivery,
        attempt,
        { succeeded: true, responseStatus: response.status, error: null, durationMs, snippet },
        { final: true, countAgainstEndpoint: true },
      );
      return { status: 'delivered' };
    }

    // Redirects are refused rather than followed (`redirect: 'manual'`), so a
    // 3xx lands here as a misconfiguration, alongside the 4xx that will not
    // change on retry.
    const retryable =
      response.status === 408 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500;
    const message = `HTTP ${response.status}`;

    await this.settle(
      delivery,
      attempt,
      { succeeded: false, responseStatus: response.status, error: message, durationMs, snippet },
      { final: !retryable || attempt >= delivery.maxAttempts, countAgainstEndpoint: true },
    );

    if (!retryable) throw new UnrecoverableError(message);
    throw new Error(message);
  }

  /** Records the attempt on the delivery and, when it counts, on the endpoint's health. */
  private async settle(
    delivery: DeliveryWithEndpoint,
    attempt: number,
    result: AttemptResult,
    options: { final: boolean; countAgainstEndpoint: boolean },
  ): Promise<void> {
    const now = new Date();
    const history = Array.isArray(delivery.attempts)
      ? (delivery.attempts as unknown as WebhookDeliveryAttempt[])
      : [];
    const attempts: WebhookDeliveryAttempt[] = [
      ...history,
      {
        at: now.toISOString(),
        succeeded: result.succeeded,
        responseStatus: result.responseStatus,
        error: result.error,
        durationMs: result.durationMs,
      },
    ];
    const status = result.succeeded
      ? WebhookDeliveryStatus.SUCCEEDED
      : options.final
        ? WebhookDeliveryStatus.FAILED
        : WebhookDeliveryStatus.PENDING;
    // Mirrors BullMQ's exponential backoff so the UI can say when the next try is.
    const nextAttemptAt =
      status === WebhookDeliveryStatus.PENDING
        ? new Date(now.getTime() + this.config.webhooks.retryBaseDelayMs * 2 ** (attempt - 1))
        : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status,
          attempt,
          responseStatus: result.responseStatus,
          responseBody: result.snippet,
          error: result.error,
          durationMs: result.durationMs,
          attempts: attempts as unknown as Prisma.InputJsonValue,
          nextAttemptAt,
          deliveredAt: result.succeeded ? now : null,
        },
      });

      if (!delivery.endpointId || !options.countAgainstEndpoint) return;

      if (result.succeeded) {
        await tx.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: {
            consecutiveFailures: 0,
            lastDeliveryAt: now,
            lastDeliveryStatus: WebhookDeliveryStatus.SUCCEEDED,
            lastSuccessAt: now,
          },
        });
        return;
      }

      if (!options.final) {
        await tx.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: { lastDeliveryAt: now, lastDeliveryStatus: WebhookDeliveryStatus.PENDING },
        });
        return;
      }

      // Atomic increment, then judge the result: two final failures landing at
      // once must not each read the same old count.
      const endpoint = await tx.webhookEndpoint.update({
        where: { id: delivery.endpointId },
        data: {
          consecutiveFailures: { increment: 1 },
          lastDeliveryAt: now,
          lastDeliveryStatus: WebhookDeliveryStatus.FAILED,
        },
        select: { consecutiveFailures: true, enabled: true, name: true },
      });

      if (
        endpoint.enabled &&
        endpoint.consecutiveFailures >= this.config.webhooks.autoDisableAfter
      ) {
        await tx.webhookEndpoint.update({
          where: { id: delivery.endpointId },
          data: {
            enabled: false,
            disabledReason: `Disabled automatically after ${endpoint.consecutiveFailures} consecutive failed deliveries.`,
          },
        });
        this.logger.warn(
          { endpointId: delivery.endpointId, failures: endpoint.consecutiveFailures },
          'Webhook endpoint disabled after repeated failures',
        );
      }
    });
  }
}
