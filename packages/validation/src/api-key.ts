import {
  API_KEY_MAX_EXPIRY_DAYS,
  API_KEY_NAME_MAX_LENGTH,
  WORKSPACE_ROLES,
} from '@coretask/contracts';
import { z } from 'zod';

export const apiKeyNameSchema = z
  .string()
  .trim()
  .min(1, 'Give the key a name — the tool it is for works well.')
  .max(API_KEY_NAME_MAX_LENGTH, `Must be at most ${API_KEY_NAME_MAX_LENGTH} characters.`);

/**
 * Every workspace role, not just the ones a key may hold: the schema checks
 * shape, and the API answers `API_KEY_ROLE_NOT_ALLOWED` for ADMIN or OWNER so
 * a tool learns *why* rather than getting a generic validation failure. The
 * picker in the web client offers only the allowed roles.
 */
export const apiKeyRoleSchema = z.enum(
  WORKSPACE_ROLES as unknown as [string, ...string[]],
  'Choose a valid role.',
);

export const createApiKeySchema = z.object({
  name: apiKeyNameSchema,
  role: apiKeyRoleSchema.optional(),
  /** Null or absent means the key does not expire. */
  expiresInDays: z
    .number()
    .int('Enter a whole number of days.')
    .min(1, 'Expiry must be at least one day away.')
    .max(API_KEY_MAX_EXPIRY_DAYS, `Expiry can be at most ${API_KEY_MAX_EXPIRY_DAYS} days away.`)
    .nullable()
    .optional(),
});
export type CreateApiKeyInput = z.input<typeof createApiKeySchema>;

export const updateApiKeySchema = z
  .object({
    name: apiKeyNameSchema.optional(),
    role: apiKeyRoleSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.role !== undefined, {
    message: 'Nothing to change.',
  });
export type UpdateApiKeyInput = z.input<typeof updateApiKeySchema>;
