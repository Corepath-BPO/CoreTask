import { SECTION_NAME_MAX_LENGTH, SECTION_NAME_MIN_LENGTH } from '@coretask/contracts';
import { z } from 'zod';

export const sectionNameSchema = z
  .string()
  .trim()
  .min(SECTION_NAME_MIN_LENGTH, 'Section name is required.')
  .max(SECTION_NAME_MAX_LENGTH, `Must be at most ${SECTION_NAME_MAX_LENGTH} characters.`);

export const createSectionSchema = z.object({
  name: sectionNameSchema,
  /**
   * Position is expressed relative to a sibling rather than as a number.
   * The server owns the fractional maths, so a client can never write a value
   * that collides with, or sorts oddly against, its neighbours.
   */
  afterSectionId: z.uuid().nullable().optional(),
  /**
   * Applied to a task moved into this section, and to nothing else.
   *
   * Optional and null by default on purpose: a section is a workflow column and
   * a status is task state, and coupling them silently is how "drag a card"
   * becomes an unexplained status change. Opting in makes the coupling a choice.
   */
  defaultStatusId: z.uuid().nullable().optional(),
});
export type CreateSectionInput = z.input<typeof createSectionSchema>;

export const updateSectionSchema = z
  .object({
    name: sectionNameSchema.optional(),
    defaultStatusId: z.uuid().nullable().optional(),
  })
  .refine((values) => Object.keys(values).length > 0, {
    message: 'Provide at least one field to update.',
  });
export type UpdateSectionInput = z.input<typeof updateSectionSchema>;

export const moveSectionSchema = z.object({
  /** `null` moves the section to the first position. */
  afterSectionId: z.uuid().nullable(),
});
export type MoveSectionInput = z.input<typeof moveSectionSchema>;
