import {
  DESCRIPTION_MAX_LENGTH,
  HEX_COLOR_PATTERN,
  TEAM_NAME_MAX_LENGTH,
  TEAM_NAME_MIN_LENGTH,
} from '@coretask/contracts';
import { z } from 'zod';

export const teamNameSchema = z
  .string()
  .trim()
  .min(TEAM_NAME_MIN_LENGTH, `Must be at least ${TEAM_NAME_MIN_LENGTH} characters.`)
  .max(TEAM_NAME_MAX_LENGTH, `Must be at most ${TEAM_NAME_MAX_LENGTH} characters.`);

export const teamColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, 'Enter a valid hex colour.');

export const createTeamSchema = z.object({
  name: teamNameSchema,
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).optional(),
  color: teamColorSchema.optional(),
  leadId: z.uuid().nullable().optional(),
});
export type CreateTeamInput = z.input<typeof createTeamSchema>;

export const updateTeamSchema = z
  .object({
    name: teamNameSchema.optional(),
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).nullable().optional(),
    color: teamColorSchema.optional(),
    leadId: z.uuid().nullable().optional(),
  })
  .refine((values) => Object.keys(values).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateTeamInput = z.input<typeof updateTeamSchema>;

/** Form-facing variant: every field is a controlled string starting at `''`. */
export const teamFormSchema = z.object({
  name: teamNameSchema,
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH),
  color: teamColorSchema,
  leadId: z.string(),
});
export type TeamFormInput = z.input<typeof teamFormSchema>;
