import { CREATABLE_WORK_ITEM_TYPES, WORK_ITEM_TYPES, WorkItemType } from '@coretask/contracts';
import { z } from 'zod';

import { uuidSchema } from './common.js';

/** Absent, explicitly null, or an id — the three things a client may send. */
const optionalNullableUuid = uuidSchema.nullish();

/**
 * Accepts any declared type — including one that cannot be created yet.
 *
 * Used where the value is being *read* (a project default, a filter). Creation
 * uses `creatableWorkItemType` below, which is the stricter one.
 */
export const workItemType = z.enum(WORK_ITEM_TYPES as [WorkItemType, ...WorkItemType[]]);

/**
 * Rejects a type with no model behind it, naming the ones that work.
 *
 * The picker disables Milestone and Approval, but a disabled control is not a
 * check — anything can post the body. Refusing here is what keeps a row from
 * being written as a task wearing a milestone's label.
 */
export const creatableWorkItemType = workItemType.refine(
  (value) => CREATABLE_WORK_ITEM_TYPES.includes(value),
  {
    message: `Only ${CREATABLE_WORK_ITEM_TYPES.join(' and ')} can be created yet`,
  },
);

const title = z.string().trim().min(1, 'A title is required').max(500);

/**
 * Opaque to the server: it is echoed on the socket event so the client that
 * sent it can tell its own write from somebody else's and avoid drawing the
 * same new row twice.
 */
const correlationId = z.string().trim().min(1).max(64).optional();

export const createWorkItemSchema = z.object({
  type: creatableWorkItemType,
  title,
  description: z.string().max(20_000).nullish(),
  sectionId: optionalNullableUuid,
  parentId: optionalNullableUuid,
  statusId: optionalNullableUuid,
  priorityId: optionalNullableUuid,
  assigneeIds: z.array(uuidSchema).max(20).optional(),
  startDate: z.string().datetime().nullish(),
  dueDate: z.string().datetime().nullish(),
  afterId: optionalNullableUuid,
  customFieldValues: z.record(z.string(), z.unknown()).optional(),
  correlationId,
});

export const updateWorkItemSchema = z
  .object({
    title: title.optional(),
    description: z.string().max(20_000).nullish(),
    statusId: optionalNullableUuid,
    priorityId: optionalNullableUuid,
    assigneeIds: z.array(uuidSchema).max(20).optional(),
    startDate: z.string().datetime().nullish(),
    dueDate: z.string().datetime().nullish(),
    correlationId,
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'correlationId'), {
    message: 'Nothing to update',
  });

export const moveWorkItemSchema = z
  .object({
    targetSectionId: uuidSchema.nullable(),
    afterId: optionalNullableUuid,
    beforeId: optionalNullableUuid,
    correlationId,
  })
  .refine((value) => !(value.afterId && value.beforeId), {
    message: 'Give afterId or beforeId, not both',
    path: ['afterId'],
  });

/**
 * `types` arrives comma-separated rather than repeated.
 *
 * Axios serialises an array as `types[]=…`, which strict validation rejects as
 * an unknown property — the same trap the field catalog hit.
 */
export const projectWorkItemQuerySchema = z.object({
  types: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((entry) => entry.trim().toUpperCase())
            .filter(Boolean)
        : undefined,
    )
    .pipe(z.array(workItemType).optional()),
  sectionId: optionalNullableUuid,
  search: z.string().trim().max(200).optional(),
  includeArchived: z.coerce.boolean().optional(),
  includeCustomFields: z.coerce.boolean().optional(),
  includeSubtaskSummary: z.coerce.boolean().optional(),
  cursor: z.string().max(200).nullish(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;
export type MoveWorkItemInput = z.infer<typeof moveWorkItemSchema>;
export type ProjectWorkItemQueryInput = z.infer<typeof projectWorkItemQuerySchema>;
