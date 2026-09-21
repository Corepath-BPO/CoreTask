/**
 * Queue and job names.
 *
 * Producers (API process) and consumers (worker process) both import these, so
 * a rename cannot silently orphan jobs already sitting in Redis.
 */
export const QueueName = {
  EMAIL: 'coretask.email',
  MAINTENANCE: 'coretask.maintenance',
  AUTOMATION: 'coretask.automation',
  WEBHOOK: 'coretask.webhook',
} as const;
export type QueueName = (typeof QueueName)[keyof typeof QueueName];

export const WebhookJob = {
  /** A domain event, to be expanded into one delivery per subscribed endpoint. */
  FAN_OUT: 'fan-out',
  /** One HTTP delivery; retried by BullMQ with backoff. */
  DELIVER: 'deliver',
  /** A "Send a webhook" automation action asking for a delivery. */
  RULE_SEND: 'rule-send',
} as const;
export type WebhookJob = (typeof WebhookJob)[keyof typeof WebhookJob];

export interface WebhookDeliverJobData {
  deliveryId: string;
}

/**
 * What a "Send a webhook" action asks for. The runner returns these instead of
 * calling anything — it holds no queue — and the automation processor enqueues
 * them once the run is over, exactly as it does the rule's events.
 */
export interface RuleWebhookRequest {
  workspaceId: string;
  projectId: string;
  ruleId: string;
  nodeId: string;
  /** A registered endpoint (signed) or, when null, the ad-hoc `url` (unsigned). */
  endpointId: string | null;
  url: string;
  entityId: string;
  trigger: string;
  /** The event that ran the rule; with rule and node it makes the request idempotent. */
  sourceEventId: string;
  correlationId: string;
  actorId: string | null;
  extra: Record<string, string>;
}

export const AutomationJob = {
  /** A domain event that may match one or more rules. */
  EVENT: 'automation-event',
} as const;
export type AutomationJob = (typeof AutomationJob)[keyof typeof AutomationJob];

export const MaintenanceJob = {
  /** Removes uploads that were started and never finished. */
  SWEEP_ABANDONED_UPLOADS: 'sweep-abandoned-uploads',
  /** Drops webhook delivery records older than `WEBHOOK_DELIVERY_RETENTION_DAYS`. */
  PURGE_WEBHOOK_DELIVERIES: 'purge-webhook-deliveries',
} as const;
export type MaintenanceJob = (typeof MaintenanceJob)[keyof typeof MaintenanceJob];

export const EmailJob = {
  WELCOME: 'welcome',
  INVITATION: 'invitation',
} as const;
export type EmailJob = (typeof EmailJob)[keyof typeof EmailJob];

export interface WelcomeEmailJobData {
  userId: string;
  email: string;
  name: string;
}

/**
 * Carries the *raw* invitation token, because the accept link is the only place
 * it ever exists in the clear — the database holds a hash. Jobs are removed on
 * completion, so it does not linger in Redis.
 */
export interface InvitationEmailJobData {
  email: string;
  token: string;
  workspaceName: string;
  invitedByName: string;
  role: string;
  /** Null when the invitation names no team. */
  teamName: string | null;
  expiresAt: string;
}

export type EmailJobData = WelcomeEmailJobData | InvitationEmailJobData;
