import type {
  SubscribableWebhookEvent,
  WebhookDeliveryStatus,
  WebhookEventType,
} from '@coretask/contracts';
import type {
  WebhookDelivery as WebhookDeliveryDto,
  WebhookDeliveryAttempt,
  WebhookDeliveryDetail,
  WebhookEndpoint as WebhookEndpointDto,
  WebhookEventPayload,
} from '@coretask/types';
import type { Prisma } from '@prisma/client';

export const endpointInclude = {
  project: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true, avatarUrl: true, isServiceAccount: true } },
} satisfies Prisma.WebhookEndpointInclude;

export type EndpointRow = Prisma.WebhookEndpointGetPayload<{ include: typeof endpointInclude }>;

/** Never the secret: it is returned by create and rotate, and nowhere else. */
export function toWebhookEndpointDto(row: EndpointRow): WebhookEndpointDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    url: row.url,
    events: row.events as SubscribableWebhookEvent[],
    project: row.project,
    enabled: row.enabled,
    disabledReason: row.disabledReason,
    consecutiveFailures: row.consecutiveFailures,
    lastDeliveryAt: row.lastDeliveryAt?.toISOString() ?? null,
    lastDeliveryStatus: (row.lastDeliveryStatus as WebhookDeliveryStatus | null) ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The list omits the payload, response body and attempt history; the detail carries them. */
export const deliverySummarySelect = {
  id: true,
  workspaceId: true,
  endpointId: true,
  ruleId: true,
  eventType: true,
  eventId: true,
  correlationId: true,
  url: true,
  status: true,
  attempt: true,
  maxAttempts: true,
  responseStatus: true,
  error: true,
  durationMs: true,
  nextAttemptAt: true,
  deliveredAt: true,
  createdAt: true,
  updatedAt: true,
  endpoint: { select: { name: true } },
} satisfies Prisma.WebhookDeliverySelect;

export type DeliverySummaryRow = Prisma.WebhookDeliveryGetPayload<{
  select: typeof deliverySummarySelect;
}>;

export const deliveryDetailSelect = {
  ...deliverySummarySelect,
  payload: true,
  responseBody: true,
  attempts: true,
} satisfies Prisma.WebhookDeliverySelect;

export type DeliveryDetailRow = Prisma.WebhookDeliveryGetPayload<{
  select: typeof deliveryDetailSelect;
}>;

export function toWebhookDeliveryDto(row: DeliverySummaryRow): WebhookDeliveryDto {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    endpointId: row.endpointId,
    endpointName: row.endpoint?.name ?? null,
    ruleId: row.ruleId,
    eventType: row.eventType as WebhookEventType,
    eventId: row.eventId,
    correlationId: row.correlationId,
    url: row.url,
    status: row.status as WebhookDeliveryStatus,
    attempt: row.attempt,
    maxAttempts: row.maxAttempts,
    responseStatus: row.responseStatus,
    error: row.error,
    durationMs: row.durationMs,
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toWebhookDeliveryDetailDto(row: DeliveryDetailRow): WebhookDeliveryDetail {
  return {
    ...toWebhookDeliveryDto(row),
    payload: row.payload as unknown as WebhookEventPayload,
    responseBody: row.responseBody,
    attempts: (row.attempts as unknown as WebhookDeliveryAttempt[] | null) ?? [],
  };
}
