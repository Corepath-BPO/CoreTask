import {
  BULK_FIELD_VALUE_LIMIT,
  CREATABLE_WORK_ITEM_TYPES,
  MAX_FILTERS_PER_VIEW,
  MAX_SORTS_PER_VIEW,
  RICH_TEXT_MAX_LENGTH,
  WORK_ITEM_TYPES,
  type WorkItemType,
} from '@coretask/contracts';
import { z } from 'zod';

import { uuidSchema } from './common.js';
import { setCustomFieldValueSchema } from './custom-field-value.js';
import { fieldRefSchema, filterConditionSchema, sortEntrySchema } from './project-view.js';

/** Absent, explicitly null, or an id — the three things a client may send. */
const optionalNullableUuid = uuidSchema.nullish();

/**
 * A status or priority reference: a definition id, or a legacy enum value.
 *
 * Not a uuid. A task whose status has not been backfilled has no definition
 * row, so the read model hands out `IN_PROGRESS` as the id — and a ticket's
 * status is *only* ever an enum. Whatever the server hands out has to be
 * accepted back, or setting a status from the List fails on exactly the rows
 * that have not been migrated yet.
 */
const stateRef = z
  .union([uuidSchema, z.string().regex(/^[A-Z][A-Z_]{1,40}$/, 'Not a status or priority')])
  .nullish();

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

/**
 * A time of day never travels without its date — the same rule the task schema
 * enforces, because both endpoints write the same columns.
 */
const timeNeedsDate = (value: {
  startDate?: string | null;
  startAt?: string | null;
  dueDate?: string | null;
  dueAt?: string | null;
}): boolean =>
  !(value.dueDate === null && typeof value.dueAt === 'string') &&
  !(value.startDate === null && typeof value.startAt === 'string');

const TIME_NEEDS_DATE = { message: 'A time needs a date to go with it', path: ['dueAt'] };

export const createWorkItemSchema = z
  .object({
    type: creatableWorkItemType,
    title,
    description: z.string().max(RICH_TEXT_MAX_LENGTH).nullish(),
    sectionId: optionalNullableUuid,
    parentId: optionalNullableUuid,
    statusId: stateRef,
    priorityId: stateRef,
    assigneeIds: z.array(uuidSchema).max(20).optional(),
    startDate: z.string().datetime().nullish(),
    startAt: z.string().datetime().nullish(),
    dueDate: z.string().datetime().nullish(),
    dueAt: z.string().datetime().nullish(),
    afterId: optionalNullableUuid,
    customFieldValues: z.record(z.string(), z.unknown()).optional(),
    correlationId,
  })
  .refine(timeNeedsDate, TIME_NEEDS_DATE);

export const updateWorkItemSchema = z
  .object({
    title: title.optional(),
    description: z.string().max(RICH_TEXT_MAX_LENGTH).nullish(),
    statusId: stateRef,
    priorityId: stateRef,
    assigneeIds: z.array(uuidSchema).max(20).optional(),
    startDate: z.string().datetime().nullish(),
    startAt: z.string().datetime().nullish(),
    dueDate: z.string().datetime().nullish(),
    dueAt: z.string().datetime().nullish(),
    correlationId,
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'correlationId'), {
    message: 'Nothing to update',
  })
  .refine(timeNeedsDate, TIME_NEEDS_DATE);

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

/** How many rows one bulk request may touch. A selection is a screenful, not a project. */
export const BULK_WORK_ITEM_LIMIT = 100;

/**
 * The fields a selection can change together.
 *
 * No title and no description: those are one row's own words, and writing the
 * same sentence onto twenty tasks is never what anyone meant. `strict` so a
 * stray field is refused rather than silently ignored.
 */
const bulkWorkItemUpdate = z
  .object({
    statusId: stateRef,
    priorityId: stateRef,
    assigneeIds: z.array(uuidSchema).max(20).optional(),
    startDate: z.string().datetime().nullish(),
    startAt: z.string().datetime().nullish(),
    dueDate: z.string().datetime().nullish(),
    dueAt: z.string().datetime().nullish(),
    /**
     * Custom field values keyed by field id — the same body a single edit
     * sends, applied to every task in the selection. Tickets hold no custom
     * fields and are skipped.
     */
    customFieldValues: z
      .record(uuidSchema, setCustomFieldValueSchema)
      .refine((values) => Object.keys(values).length > 0, { message: 'Nothing to set' })
      .refine((values) => Object.keys(values).length <= BULK_FIELD_VALUE_LIMIT, {
        message: `At most ${BULK_FIELD_VALUE_LIMIT} fields at once`,
      })
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'Nothing to update' })
  .refine(timeNeedsDate, TIME_NEEDS_DATE);

/**
 * One request for everything the bulk bar can do.
 *
 * `update` changes fields, `sectionId` moves (null detaches from every
 * section), `archived` archives. They may be combined; each is applied to every
 * id in the order given, so the rows keep their relative order when moved.
 */
export const bulkWorkItemSchema = z
  .object({
    workItemIds: z
      .array(uuidSchema)
      .min(1)
      .max(BULK_WORK_ITEM_LIMIT)
      // The same row named twice is one row; applying twice would double
      // its activity and move it back behind itself.
      .transform((ids) => [...new Set(ids)]),
    update: bulkWorkItemUpdate.optional(),
    sectionId: uuidSchema.nullable().optional(),
    archived: z.literal(true).optional(),
    correlationId,
  })
  .refine(
    (value) => value.update !== undefined || value.sectionId !== undefined || value.archived,
    { message: 'Nothing to do' },
  );

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
  /*
   * The view's settings, as JSON in the query string.
   *
   * A GET rather than a POST, because the cache keys and the realtime
   * invalidation are built on it; JSON rather than a bespoke encoding, because
   * both sides already agree on the shape. Each is parsed with a guard so
   * malformed JSON is an issue on the parameter, not a 500.
   */
  filters: jsonParameter(z.array(filterConditionSchema).max(MAX_FILTERS_PER_VIEW)),
  sorts: jsonParameter(z.array(sortEntrySchema).max(MAX_SORTS_PER_VIEW)),
  groupBy: fieldRefSchema.optional(),
  /*
   * Not `z.coerce.boolean()`, which reads the string "false" as true: the
   * only value worth sending is the one that hides completed rows, and it
   * would have been read as the opposite.
   */
  showCompleted: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
});

/** A JSON-encoded query parameter, guarded so bad JSON is an issue, not a throw. */
function jsonParameter<T extends z.ZodTypeAny>(schema: T) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (raw === undefined || raw === '') return undefined;
      try {
        return JSON.parse(raw) as unknown;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'Not valid JSON.' });
        return z.NEVER;
      }
    })
    .pipe(schema.optional());
}

export type CreateWorkItemInput = z.infer<typeof createWorkItemSchema>;
export type UpdateWorkItemInput = z.infer<typeof updateWorkItemSchema>;
export type MoveWorkItemInput = z.infer<typeof moveWorkItemSchema>;
export type BulkWorkItemInput = z.infer<typeof bulkWorkItemSchema>;
export type ProjectWorkItemQueryInput = z.infer<typeof projectWorkItemQuerySchema>;
