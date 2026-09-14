import { AutomationTrigger } from './automation.js';

/**
 * Outbound webhooks: CoreTask POSTs a signed JSON event to a URL an admin
 * registered, when something the endpoint subscribed to happens.
 *
 * Event names are the friendly, dotted kind the receiving side expects
 * (`task.completed`), not the automation trigger names that raise them.
 */
export const WebhookEventType = {
  TASK_CREATED: 'task.created',
  TASK_UPDATED: 'task.updated',
  TASK_COMPLETED: 'task.completed',
  TASK_MOVED: 'task.moved',
  TASK_ASSIGNED: 'task.assigned',
  TASK_DUE_DATE_CHANGED: 'task.due_date_changed',
  COMMENT_CREATED: 'comment.created',
  TICKET_CREATED: 'ticket.created',
  TICKET_STATUS_CHANGED: 'ticket.status_changed',
  CUSTOM_FIELD_CHANGED: 'custom_field.changed',
  /** Sent by the "Send test event" button. Not a subscription. */
  PING: 'ping',
  /** Sent by the "Send a webhook" automation action. Not a subscription. */
  AUTOMATION_WEBHOOK: 'automation.webhook',
} as const;
export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];
export const WEBHOOK_EVENT_TYPES = Object.values(WebhookEventType);

/** What an endpoint can subscribe to. `ping` and rule sends arrive regardless. */
export const SUBSCRIBABLE_WEBHOOK_EVENTS = [
  WebhookEventType.TASK_CREATED,
  WebhookEventType.TASK_UPDATED,
  WebhookEventType.TASK_COMPLETED,
  WebhookEventType.TASK_MOVED,
  WebhookEventType.TASK_ASSIGNED,
  WebhookEventType.TASK_DUE_DATE_CHANGED,
  WebhookEventType.COMMENT_CREATED,
  WebhookEventType.TICKET_CREATED,
  WebhookEventType.TICKET_STATUS_CHANGED,
  WebhookEventType.CUSTOM_FIELD_CHANGED,
] as const;
export type SubscribableWebhookEvent = (typeof SUBSCRIBABLE_WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_LABEL: Record<WebhookEventType, string> = {
  'task.created': 'Task created',
  'task.updated': 'Task updated',
  'task.completed': 'Task completed',
  'task.moved': 'Task moved to a section',
  'task.assigned': 'Task assigned',
  'task.due_date_changed': 'Task due date changed',
  'comment.created': 'Comment added',
  'ticket.created': 'Ticket reported',
  'ticket.status_changed': 'Ticket status changed',
  'custom_field.changed': 'Custom field changed',
  ping: 'Test event',
  'automation.webhook': 'Sent by a rule',
};

/** How the event picker groups its checkboxes. */
export const WEBHOOK_EVENT_GROUPS: readonly {
  label: string;
  events: readonly SubscribableWebhookEvent[];
}[] = [
  {
    label: 'Tasks',
    events: [
      WebhookEventType.TASK_CREATED,
      WebhookEventType.TASK_UPDATED,
      WebhookEventType.TASK_COMPLETED,
      WebhookEventType.TASK_MOVED,
      WebhookEventType.TASK_ASSIGNED,
      WebhookEventType.TASK_DUE_DATE_CHANGED,
    ],
  },
  { label: 'Comments', events: [WebhookEventType.COMMENT_CREATED] },
  {
    label: 'Tickets',
    events: [WebhookEventType.TICKET_CREATED, WebhookEventType.TICKET_STATUS_CHANGED],
  },
  { label: 'Custom fields', events: [WebhookEventType.CUSTOM_FIELD_CHANGED] },
];

export type WebhookEntityType = 'TASK' | 'TICKET' | 'COMMENT';

const TRIGGER_TO_EVENT: Partial<
  Record<AutomationTrigger, { type: WebhookEventType; entity: WebhookEntityType }>
> = {
  [AutomationTrigger.TASK_CREATED]: { type: WebhookEventType.TASK_CREATED, entity: 'TASK' },
  [AutomationTrigger.TASK_UPDATED]: { type: WebhookEventType.TASK_UPDATED, entity: 'TASK' },
  [AutomationTrigger.TASK_COMPLETED]: { type: WebhookEventType.TASK_COMPLETED, entity: 'TASK' },
  [AutomationTrigger.TASK_MOVED_TO_SECTION]: { type: WebhookEventType.TASK_MOVED, entity: 'TASK' },
  [AutomationTrigger.TASK_ASSIGNED]: { type: WebhookEventType.TASK_ASSIGNED, entity: 'TASK' },
  [AutomationTrigger.TASK_DUE_DATE_CHANGED]: {
    type: WebhookEventType.TASK_DUE_DATE_CHANGED,
    entity: 'TASK',
  },
  [AutomationTrigger.COMMENT_ADDED]: { type: WebhookEventType.COMMENT_CREATED, entity: 'COMMENT' },
  [AutomationTrigger.TICKET_CREATED]: { type: WebhookEventType.TICKET_CREATED, entity: 'TICKET' },
  [AutomationTrigger.TICKET_STATUS_CHANGED]: {
    type: WebhookEventType.TICKET_STATUS_CHANGED,
    entity: 'TICKET',
  },
  [AutomationTrigger.CUSTOM_FIELD_CHANGED]: {
    type: WebhookEventType.CUSTOM_FIELD_CHANGED,
    entity: 'TASK',
  },
};

/**
 * Triggers that deliberately raise no webhook of their own: each is a field
 * change, and `task.updated` already carries every changed field in `changes`.
 * One notification per edit is what a receiver wants, not six.
 */
export const UNMAPPED_WEBHOOK_TRIGGERS = [
  AutomationTrigger.TASK_STATUS_CHANGED,
  AutomationTrigger.TASK_PRIORITY_CHANGED,
  AutomationTrigger.TASK_START_DATE_CHANGED,
  AutomationTrigger.TASK_ESTIMATE_CHANGED,
  AutomationTrigger.TASK_TITLE_CHANGED,
  AutomationTrigger.TASK_DESCRIPTION_CHANGED,
] as const;

/**
 * The webhook event a domain event becomes, or null when it becomes none.
 *
 * The entity type matters as well as the trigger: a ticket moved through the
 * work-items route raises TASK_MOVED_TO_SECTION with a ticket entity, which is
 * not a `task.moved`.
 */
export function webhookEventTypeFor(
  trigger: AutomationTrigger,
  entityType: WebhookEntityType,
): WebhookEventType | null {
  const mapping = TRIGGER_TO_EVENT[trigger];
  return mapping && mapping.entity === entityType ? mapping.type : null;
}

export const WebhookDeliveryStatus = {
  PENDING: 'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;
export type WebhookDeliveryStatus =
  (typeof WebhookDeliveryStatus)[keyof typeof WebhookDeliveryStatus];
export const WEBHOOK_DELIVERY_STATUSES = Object.values(WebhookDeliveryStatus);

// Headers on every delivery. Lower-case, as Node reads them.
export const WEBHOOK_SIGNATURE_HEADER = 'x-coretask-signature';
export const WEBHOOK_EVENT_HEADER = 'x-coretask-event';
export const WEBHOOK_EVENT_ID_HEADER = 'x-coretask-event-id';
export const WEBHOOK_DELIVERY_HEADER = 'x-coretask-delivery';
export const WEBHOOK_WORKSPACE_HEADER = 'x-coretask-workspace';
export const WEBHOOK_USER_AGENT = 'CoreTask-Webhooks/1.0';

/** `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<body>">`; receivers reject older timestamps. */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

export const WEBHOOK_SECRET_PREFIX = 'whsec_';
export const WEBHOOK_SECRET_MIN_LENGTH = 16;
export const WEBHOOK_SECRET_MAX_LENGTH = 128;
export const WEBHOOK_NAME_MAX_LENGTH = 80;
export const WEBHOOK_URL_MAX_LENGTH = 2048;
export const MAX_WEBHOOK_ENDPOINTS_PER_WORKSPACE = 20;
/** Response bodies are kept for diagnosis only, so they are cut short. */
export const WEBHOOK_RESPONSE_SNIPPET_LENGTH = 500;
export const WEBHOOK_DELIVERY_PAGE_LIMIT = 25;
export const WEBHOOK_DELIVERY_PAGE_MAX = 100;

/*
 * The "Send a webhook" automation action. Its configuration names either a
 * registered endpoint or an ad-hoc URL, plus optional extra fields the rule
 * wants to say — a flow name, a tag — merged into the payload as `data.extra`.
 * No secret lives in a rule: rule configurations are readable by every member.
 */
export const WEBHOOK_EXTRA_FIELDS_MAX = 10;
export const WEBHOOK_EXTRA_FIELD_KEY_MAX_LENGTH = 60;
export const WEBHOOK_EXTRA_FIELD_VALUE_MAX_LENGTH = 200;

export interface WebhookExtraField {
  key: string;
  value: string;
}

/** The rows as the builder edits them: blanks allowed while typing. */
export function webhookExtraFieldRows(value: unknown): WebhookExtraField[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((row) => {
    if (typeof row !== 'object' || row === null) return [];
    const key = (row as { key?: unknown }).key;
    const fieldValue = (row as { value?: unknown }).value;
    return [
      {
        key: typeof key === 'string' ? key : '',
        value: typeof fieldValue === 'string' ? fieldValue : '',
      },
    ];
  });
}

/** The rows as the runner sends them: blank keys dropped, sizes capped, later duplicates win. */
export function webhookExtraFields(value: unknown): Record<string, string> {
  const extra: Record<string, string> = {};

  for (const row of webhookExtraFieldRows(value).slice(0, WEBHOOK_EXTRA_FIELDS_MAX)) {
    const key = row.key.trim().slice(0, WEBHOOK_EXTRA_FIELD_KEY_MAX_LENGTH);
    if (key === '') continue;
    extra[key] = row.value.trim().slice(0, WEBHOOK_EXTRA_FIELD_VALUE_MAX_LENGTH);
  }

  return extra;
}
