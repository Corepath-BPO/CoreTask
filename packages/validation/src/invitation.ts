import { EMAIL_MAX_LENGTH, WORKSPACE_ROLES } from '@coretask/contracts';
import { z } from 'zod';

/** Lower-cased so the unique constraint on (workspace, e-mail) is case-blind. */
export const invitationEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'E-mail address is required.')
  .max(EMAIL_MAX_LENGTH, `Must be at most ${EMAIL_MAX_LENGTH} characters.`)
  .pipe(z.email('Enter a valid e-mail address.'));

/**
 * `OWNER` is intentionally still in this list: the schema checks shape, and the
 * API decides what the *caller* may grant. Rejecting it here as well would give
 * a client-side rule the appearance of being the security boundary.
 */
export const invitationRoleSchema = z.enum(
  WORKSPACE_ROLES as unknown as [string, ...string[]],
  'Choose a valid role.',
);

export const createInvitationSchema = z.object({
  email: invitationEmailSchema,
  role: invitationRoleSchema,
  /** `''` is what an untouched picker sends, and means "no team". */
  teamId: z.union([z.literal(''), z.uuid()]).optional(),
});
export type CreateInvitationInput = z.input<typeof createInvitationSchema>;
