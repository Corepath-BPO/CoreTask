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
  IMPORT: 'coretask.import',
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

export const ImportJob = {
  /** One run of the Asana importer, start to finish. */
  ASANA: 'asana-import',
  /** Live sync: Asana's event streams read, and the tasks they name written. */
  ASANA_LIVE_SYNC: 'asana-live-sync',
  /** The nightly full Sync again behind live sync. */
  ASANA_NIGHTLY_SYNC: 'asana-nightly-sync',
} as const;
export type ImportJob = (typeof ImportJob)[keyof typeof ImportJob];

export interface ImportJobData {
  runId: string;
}

export const MaintenanceJob = {
  /** Removes uploads that were started and never finished. */
  SWEEP_ABANDONED_UPLOADS: 'sweep-abandoned-uploads',
  /** Drops webhook delivery records older than `WEBHOOK_DELIVERY_RETENTION_DAYS`. */
  PURGE_WEBHOOK_DELIVERIES: 'purge-webhook-deliveries',
  /** Fires the time-driven automation triggers that have come due. */
  AUTOMATION_CLOCK: 'automation-clock',
} as const;
export type MaintenanceJob = (typeof MaintenanceJob)[keyof typeof MaintenanceJob];

export const EmailJob = {
  /** "Confirm your e-mail address" — on sign-up, where it is also the welcome. */
  EMAIL_VERIFICATION: 'email-verification',
  INVITATION: 'invitation',
  /** A message already written by the API — a task's update to its email thread. */
  MESSAGE: 'message',
  PASSWORD_RESET: 'password-reset',
  /** "Confirm your new address", to the address the account is moving to. */
  EMAIL_CHANGE: 'email-change',
} as const;
export type EmailJob = (typeof EmailJob)[keyof typeof EmailJob];

/**
 * Carries the *raw* confirmation token, for the same reason a reset does.
 * Removed on completion so it does not linger in Redis.
 */
export interface EmailVerificationJobData {
  userId: string;
  email: string;
  name: string;
  token: string;
  expiresAt: string;
  welcome: boolean;
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
  /** The project it lands them in, from a Share dialog; null otherwise. */
  projectName: string | null;
  expiresAt: string;
}

/**
 * What a "Send an email" action asks for: one message to one person, written
 * by the rule. Composed with the task's link and queued by the automation
 * processor once the run is over, as webhooks are.
 */
export interface RuleEmailRequest {
  to: string;
  subject: string;
  /** The rule's words, variables filled in. Plain text. */
  body: string;
  taskId: string;
  taskTitle: string;
  /** Where the link goes, when it is not the task — a ticket's page. */
  path?: string;
  ruleName: string;
}

export interface MessageEmailJobData {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

/**
 * Carries the *raw* reset token, because the link is the only place it exists
 * in the clear — the database holds a hash. Removed on completion, as an
 * invitation's job is, so it does not linger in Redis.
 */
export interface PasswordResetEmailJobData {
  email: string;
  name: string;
  token: string;
  expiresAt: string;
}

/** Carries the *raw* token, like a reset; removed on completion. */
export interface EmailChangeJobData {
  userId: string;
  /** The new address — where the link goes. */
  email: string;
  name: string;
  token: string;
  expiresAt: string;
}

export type EmailJobData =
  | EmailChangeJobData
  | EmailVerificationJobData
  | InvitationEmailJobData
  | MessageEmailJobData
  | PasswordResetEmailJobData;
