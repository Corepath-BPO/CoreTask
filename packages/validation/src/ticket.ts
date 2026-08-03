import {
  DESCRIPTION_MAX_LENGTH,
  TICKET_PRIORITIES,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  TICKET_TITLE_MAX_LENGTH,
  TICKET_TITLE_MIN_LENGTH,
  TICKET_TYPES,
} from '@coretask/contracts';
import { z } from 'zod';

export const ticketTitleSchema = z
  .string()
  .trim()
  .min(TICKET_TITLE_MIN_LENGTH, 'Ticket title is required.')
  .max(TICKET_TITLE_MAX_LENGTH, `Must be at most ${TICKET_TITLE_MAX_LENGTH} characters.`);

export const ticketTypeSchema = z.enum(
  TICKET_TYPES as unknown as [string, ...string[]],
  'Choose a valid type.',
);
export const ticketStatusSchema = z.enum(
  TICKET_STATUSES as unknown as [string, ...string[]],
  'Choose a valid status.',
);
export const ticketPrioritySchema = z.enum(
  TICKET_PRIORITIES as unknown as [string, ...string[]],
  'Choose a valid priority.',
);
export const ticketSeveritySchema = z.enum(
  TICKET_SEVERITIES as unknown as [string, ...string[]],
  'Choose a valid severity.',
);

/** Accepts an ISO date or datetime; an empty string clears the field. */
const optionalDate = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine((value) => value === null || !Number.isNaN(Date.parse(value)), 'Enter a valid date.');

export const createTicketSchema = z.object({
  title: ticketTitleSchema,
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).optional(),
  projectId: z.uuid().nullable().optional(),
  type: ticketTypeSchema.optional(),
  status: ticketStatusSchema.optional(),
  priority: ticketPrioritySchema.optional(),
  severity: ticketSeveritySchema.optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueDate: optionalDate.optional(),
});
export type CreateTicketInput = z.input<typeof createTicketSchema>;

/**
 * `key`, `number` and `reporterId` are absent on purpose.
 *
 * The key is quoted in conversations, commits and links, so it is fixed for the
 * ticket's lifetime; the reporter is who actually filed it, which is a fact
 * rather than a setting.
 */
export const updateTicketSchema = z
  .object({
    title: ticketTitleSchema.optional(),
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    type: ticketTypeSchema.optional(),
    status: ticketStatusSchema.optional(),
    priority: ticketPrioritySchema.optional(),
    severity: ticketSeveritySchema.optional(),
    assigneeId: z.uuid().nullable().optional(),
    dueDate: optionalDate.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateTicketInput = z.input<typeof updateTicketSchema>;

/** Form-facing variant: every field is a controlled string starting at `''`. */
export const ticketFormSchema = z.object({
  title: ticketTitleSchema,
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH),
  type: ticketTypeSchema,
  priority: ticketPrioritySchema,
  severity: ticketSeveritySchema,
  projectId: z.string(),
  assigneeId: z.string(),
  dueDate: z.string().trim(),
});
export type TicketFormInput = z.input<typeof ticketFormSchema>;
