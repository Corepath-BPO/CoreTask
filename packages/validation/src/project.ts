import {
  DESCRIPTION_MAX_LENGTH,
  HEX_COLOR_PATTERN,
  PROJECT_KEY_MAX_LENGTH,
  PROJECT_KEY_MIN_LENGTH,
  PROJECT_KEY_PATTERN,
  PROJECT_NAME_MAX_LENGTH,
  PROJECT_NAME_MIN_LENGTH,
  PROJECT_STATUSES,
} from '@coretask/contracts';
import { z } from 'zod';

export const projectNameSchema = z
  .string()
  .trim()
  .min(PROJECT_NAME_MIN_LENGTH, 'Project name is required.')
  .max(PROJECT_NAME_MAX_LENGTH, `Must be at most ${PROJECT_NAME_MAX_LENGTH} characters.`);

export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(PROJECT_KEY_MIN_LENGTH, `Must be at least ${PROJECT_KEY_MIN_LENGTH} characters.`)
  .max(PROJECT_KEY_MAX_LENGTH, `Must be at most ${PROJECT_KEY_MAX_LENGTH} characters.`)
  .regex(PROJECT_KEY_PATTERN, 'Start with a letter, then letters and numbers only.');

export const projectStatusSchema = z.enum(
  PROJECT_STATUSES as unknown as [string, ...string[]],
  'Choose a valid status.',
);

export const projectColorSchema = z
  .string()
  .trim()
  .regex(HEX_COLOR_PATTERN, 'Enter a hex colour such as #6366F1.');

/** Accepts an ISO date or datetime; empty string clears the field. */
const optionalDate = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .refine((value) => value === null || !Number.isNaN(Date.parse(value)), 'Enter a valid date.');

export const createProjectSchema = z.object({
  name: projectNameSchema,
  key: projectKeySchema.optional(),
  description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).optional(),
  status: projectStatusSchema.optional(),
  color: projectColorSchema.optional(),
  leadId: z.uuid().nullable().optional(),
  startDate: optionalDate.optional(),
  dueDate: optionalDate.optional(),
});
export type CreateProjectInput = z.input<typeof createProjectSchema>;

/**
 * The key is deliberately absent: it is embedded in every ticket reference
 * (`CORE-1001`), so renaming it would invalidate links people have already
 * shared. Changing it needs a dedicated migration flow, not a PATCH.
 */
export const updateProjectSchema = z
  .object({
    name: projectNameSchema.optional(),
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH).nullable().optional(),
    status: projectStatusSchema.optional(),
    color: projectColorSchema.optional(),
    leadId: z.uuid().nullable().optional(),
    startDate: optionalDate.optional(),
    dueDate: optionalDate.optional(),
  })
  .refine((values) => Object.keys(values).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateProjectInput = z.input<typeof updateProjectSchema>;

/**
 * Form-facing variant.
 *
 * Bound to controlled inputs, which start as `''` rather than `undefined`, and
 * a date range that only makes sense when checked across both fields.
 */
export const projectFormSchema = z
  .object({
    name: projectNameSchema,
    key: z.union([z.literal(''), projectKeySchema]).optional(),
    description: z.string().trim().max(DESCRIPTION_MAX_LENGTH),
    status: projectStatusSchema,
    color: projectColorSchema,
    /** `''` means "no team" — a native select cannot hold null. */
    teamId: z.string(),
    startDate: z.string().trim(),
    dueDate: z.string().trim(),
  })
  .refine(
    (values) =>
      !values.startDate ||
      !values.dueDate ||
      Date.parse(values.startDate) <= Date.parse(values.dueDate),
    { message: 'The due date cannot be before the start date.', path: ['dueDate'] },
  );
export type ProjectFormInput = z.input<typeof projectFormSchema>;

/**
 * Derives a project key from its name: initials for multi-word names
 * (`Customer Onboarding` -> `CO`), otherwise a prefix (`Platform` -> `PLAT`).
 *
 * Shared so the web client can preview the key while typing and the API can
 * derive the same value when the client omits it.
 */
export function deriveProjectKey(name: string): string {
  const words = name
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);

  if (words.length === 0) return 'PROJ';

  const candidate =
    words.length > 1
      ? words
          .map((word) => word[0])
          .join('')
          .slice(0, PROJECT_KEY_MAX_LENGTH)
      : (words[0] as string).slice(0, 4);

  // A key must start with a letter and be at least two characters.
  return PROJECT_KEY_PATTERN.test(candidate) ? candidate : `P${candidate}`.slice(0, 8) || 'PROJ';
}
