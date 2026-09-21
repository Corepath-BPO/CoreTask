import { z } from 'zod';

/**
 * One value for one field, in whichever shape the type uses — the same body
 * `PUT /tasks/:id/custom-fields/:fieldId` takes, so a bulk edit and a single
 * edit are validated alike. `strict`, so a stray key is refused rather than
 * silently ignored.
 */
export const setCustomFieldValueSchema = z
  .object({
    text: z.string().max(2000).nullish(),
    number: z.number().finite().nullish(),
    date: z.string().datetime().nullish(),
    checkbox: z.boolean().nullish(),
    optionIds: z.array(z.string().uuid()).max(50).optional(),
    userIds: z.array(z.string().uuid()).max(50).optional(),
  })
  .strict();

export type SetCustomFieldValueInput = z.input<typeof setCustomFieldValueSchema>;
