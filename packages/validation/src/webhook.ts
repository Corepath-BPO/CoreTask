import {
  SUBSCRIBABLE_WEBHOOK_EVENTS,
  WEBHOOK_DELIVERY_PAGE_LIMIT,
  WEBHOOK_DELIVERY_PAGE_MAX,
  WEBHOOK_DELIVERY_STATUSES,
  WEBHOOK_NAME_MAX_LENGTH,
  WEBHOOK_SECRET_MAX_LENGTH,
  WEBHOOK_SECRET_MIN_LENGTH,
  WEBHOOK_URL_MAX_LENGTH,
} from '@coretask/contracts';
import { z } from 'zod';

export const webhookNameSchema = z
  .string()
  .trim()
  .min(1, 'Name the endpoint — the tool it points at works well.')
  .max(WEBHOOK_NAME_MAX_LENGTH, `Must be at most ${WEBHOOK_NAME_MAX_LENGTH} characters.`);

/**
 * Shape only. Whether the address is one CoreTask may call — not a private
 * network, not a loopback — is the API's decision, and it can differ between a
 * laptop running n8n locally and a production deployment.
 */
export const webhookUrlSchema = z
  .string()
  .trim()
  .min(1, 'Enter the URL to send to.')
  .max(WEBHOOK_URL_MAX_LENGTH, `Must be at most ${WEBHOOK_URL_MAX_LENGTH} characters.`)
  .pipe(z.url('Enter a full URL, starting with https:// or http://.'));

export const webhookEventsSchema = z
  .array(
    z.enum(SUBSCRIBABLE_WEBHOOK_EVENTS as unknown as [string, ...string[]], 'Choose valid events.'),
  )
  .min(1, 'Choose at least one event.');

export const webhookSecretSchema = z
  .string()
  .trim()
  .min(WEBHOOK_SECRET_MIN_LENGTH, `Must be at least ${WEBHOOK_SECRET_MIN_LENGTH} characters.`)
  .max(WEBHOOK_SECRET_MAX_LENGTH, `Must be at most ${WEBHOOK_SECRET_MAX_LENGTH} characters.`);

export const createWebhookSchema = z.object({
  name: webhookNameSchema,
  url: webhookUrlSchema,
  events: webhookEventsSchema,
  /** Null or absent means every project in the workspace. */
  projectId: z.uuid().nullable().optional(),
  /** Generated server-side when absent. */
  secret: webhookSecretSchema.optional(),
  enabled: z.boolean().optional(),
});
export type CreateWebhookInput = z.input<typeof createWebhookSchema>;

export const updateWebhookSchema = z
  .object({
    name: webhookNameSchema.optional(),
    url: webhookUrlSchema.optional(),
    events: webhookEventsSchema.optional(),
    projectId: z.uuid().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to change.',
  });
export type UpdateWebhookInput = z.input<typeof updateWebhookSchema>;

/** Query-string values arrive as strings, hence the coercion on `limit`. */
export const webhookDeliveryQuerySchema = z.object({
  endpointId: z.uuid().optional(),
  ruleId: z.uuid().optional(),
  status: z.enum(WEBHOOK_DELIVERY_STATUSES as unknown as [string, ...string[]]).optional(),
  before: z.uuid().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(WEBHOOK_DELIVERY_PAGE_MAX)
    .default(WEBHOOK_DELIVERY_PAGE_LIMIT),
});
export type WebhookDeliveryQueryInput = z.input<typeof webhookDeliveryQuerySchema>;
