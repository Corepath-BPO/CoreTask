import {
  DESCRIPTION_MAX_LENGTH,
  WORKSPACE_NAME_MAX_LENGTH,
  WORKSPACE_NAME_MIN_LENGTH,
  WORKSPACE_SLUG_MAX_LENGTH,
  WORKSPACE_SLUG_MIN_LENGTH,
  WORKSPACE_SLUG_PATTERN,
} from '@coretask/contracts';
import { z } from 'zod';

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(WORKSPACE_NAME_MIN_LENGTH, 'Workspace name is required.')
  .max(WORKSPACE_NAME_MAX_LENGTH, `Must be at most ${WORKSPACE_NAME_MAX_LENGTH} characters.`);

export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(WORKSPACE_SLUG_MIN_LENGTH, 'Workspace URL is required.')
  .max(WORKSPACE_SLUG_MAX_LENGTH, `Must be at most ${WORKSPACE_SLUG_MAX_LENGTH} characters.`)
  .regex(WORKSPACE_SLUG_PATTERN, 'Use lowercase letters, numbers and single hyphens.');

export const createWorkspaceSchema = z.object({
  name: workspaceNameSchema,
  /** Derived from `name` on the server when omitted. */
  slug: workspaceSlugSchema.optional(),
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).optional(),
});
export type CreateWorkspaceInput = z.input<typeof createWorkspaceSchema>;

export const updateWorkspaceSchema = z
  .object({
    name: workspaceNameSchema.optional(),
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).nullable().optional(),
    logoUrl: z.url('Enter a valid URL.').nullable().optional(),
  })
  .refine((values) => Object.keys(values).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceSchema>;
