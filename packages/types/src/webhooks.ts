import type {
  SubscribableWebhookEvent,
  WebhookDeliveryStatus,
  WebhookEventType,
} from '@coretask/contracts';

export interface WebhookEndpointCreator {
  id: string;
  name: string;
  email: string;
  avatarUrl: string | null;
}

/**
 * An outbound webhook subscription as the settings page sees it.
 *
 * The signing secret is absent on purpose: it is returned when the endpoint is
 * created and when it is rotated, and stored encrypted — never listed.
 */
export interface WebhookEndpoint {
  id: string;
  workspaceId: string;
  name: string;
  url: string;
  events: SubscribableWebhookEvent[];
  /** Null means every project in the workspace. */
  project: { id: string; name: string } | null;
  enabled: boolean;
  /** Set when deliveries kept failing and the endpoint switched itself off. */
  disabledReason: string | null;
  consecutiveFailures: number;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: WebhookDeliveryStatus | null;
  lastSuccessAt: string | null;
  createdBy: WebhookEndpointCreator | null;
  createdAt: string;
  updatedAt: string;
}

/** The one response that carries the signing secret. */
export interface CreatedWebhookEndpoint {
  endpoint: WebhookEndpoint;
  secret: string;
}

export interface WebhookSecretRotation {
  secret: string;
}

export interface CreateWebhookPayload {
  name: string;
  url: string;
  events: SubscribableWebhookEvent[];
  /** Restrict to one project; null or absent means the whole workspace. */
  projectId?: string | null;
  /** Bring your own signing secret; generated when absent. */
  secret?: string;
  enabled?: boolean;
}

export interface UpdateWebhookPayload {
  name?: string;
  url?: string;
  events?: SubscribableWebhookEvent[];
  projectId?: string | null;
  enabled?: boolean;
}

export interface WebhookTestResult {
  deliveryId: string;
}

/** One HTTP attempt, kept on the delivery so the history shows every try. */
export interface WebhookDeliveryAttempt {
  at: string;
  succeeded: boolean;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
}

export interface WebhookDelivery {
  id: string;
  workspaceId: string;
  /** Null when a rule sent to an ad-hoc URL rather than a registered endpoint. */
  endpointId: string | null;
  endpointName: string | null;
  ruleId: string | null;
  eventType: WebhookEventType;
  /** Stable across attempts and endpoints — the receiver's idempotency key. */
  eventId: string;
  correlationId: string | null;
  url: string;
  status: WebhookDeliveryStatus;
  attempt: number;
  maxAttempts: number;
  responseStatus: number | null;
  error: string | null;
  durationMs: number | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryDetail extends WebhookDelivery {
  /** Exactly the JSON that was (or will be) sent. */
  payload: WebhookEventPayload;
  responseBody: string | null;
  attempts: WebhookDeliveryAttempt[];
}

/** Newest first, by id cursor: ids are UUID v7 and therefore time-ordered. */
export interface WebhookDeliveryPage {
  items: WebhookDelivery[];
  hasMore: boolean;
  /** Pass back as `before` to load the next, older page. */
  nextBefore: string | null;
}

export interface WebhookDeliveryListQuery {
  endpointId?: string;
  ruleId?: string;
  status?: WebhookDeliveryStatus;
  before?: string;
  limit?: number;
}

export interface WebhookActor {
  id: string;
  name: string;
  /** `integration` when an API key's service account did it. */
  kind: 'user' | 'integration';
}

/** The body of every delivery. `data` varies by `type`; `changes` is present on updates. */
export interface WebhookEventPayload {
  id: string;
  type: WebhookEventType;
  createdAt: string;
  workspaceId: string;
  projectId: string | null;
  actor: WebhookActor | null;
  /** Set when an automation rule made the change that raised this event. */
  causedByRuleId: string | null;
  correlationId: string | null;
  data: Record<string, unknown>;
  changes: Record<string, { before: unknown; after: unknown }> | null;
}
