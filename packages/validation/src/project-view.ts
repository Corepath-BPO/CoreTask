import {
  FILTER_OPERATORS,
  MAX_FILTERS_PER_VIEW,
  MAX_SORTS_PER_VIEW,
  PROJECT_VIEW_SCOPES,
  PROJECT_VIEW_TYPES,
  operatorTakesList,
  operatorTakesValue,
} from '@coretask/contracts';
import { z } from 'zod';

/**
 * A field reference: a known system column, or `custom:<uuid>`.
 *
 * The shape is checked here; whether the id names a field in *this project* is
 * checked by the service, because only it knows the project. Both matter — this
 * one stops a malformed reference reaching the compiler at all.
 */
export const fieldRefSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^(?:[a-zA-Z]+|custom:[0-9a-f-]{36})$/, 'Not a valid field reference.');

export const filterConditionSchema = z
  .object({
    field: fieldRefSchema,
    operator: z.enum(FILTER_OPERATORS as unknown as [string, ...string[]]),
    /** Absent for IS_EMPTY/IS_NOT_EMPTY, a list for IN/NOT_IN, else a scalar. */
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]).optional(),
  })
  .superRefine((condition, ctx) => {
    const operator = condition.operator as (typeof FILTER_OPERATORS)[number];
    const hasValue = condition.value !== undefined && condition.value !== null;

    // A value where none is expected is a sign the client built the wrong
    // shape, and silently ignoring it would hide that.
    if (!operatorTakesValue(operator) && hasValue) {
      ctx.addIssue({ code: 'custom', message: `${operator} takes no value.`, path: ['value'] });
      return;
    }

    if (operatorTakesValue(operator) && !hasValue) {
      ctx.addIssue({ code: 'custom', message: `${operator} needs a value.`, path: ['value'] });
      return;
    }

    if (operatorTakesList(operator) && hasValue && !Array.isArray(condition.value)) {
      ctx.addIssue({ code: 'custom', message: `${operator} needs a list.`, path: ['value'] });
    }

    if (!operatorTakesList(operator) && Array.isArray(condition.value)) {
      ctx.addIssue({
        code: 'custom',
        message: `${operator} takes a single value.`,
        path: ['value'],
      });
    }
  });
export type FilterConditionInput = z.input<typeof filterConditionSchema>;

/**
 * A single AND group for now.
 *
 * Wrapped in an object rather than being a bare array so OR groups and nesting
 * can be added later without changing the shape of every stored view — the
 * migration would otherwise have to rewrite every settings document.
 */
export const filterGroupSchema = z.object({
  combinator: z.literal('AND').default('AND'),
  conditions: z.array(filterConditionSchema).max(MAX_FILTERS_PER_VIEW).default([]),
});

export const sortEntrySchema = z.object({
  field: fieldRefSchema,
  direction: z.enum(['ASC', 'DESC']).default('ASC'),
});

export const viewColumnSchema = z.object({
  field: fieldRefSchema,
  width: z.number().int().min(60).max(800).optional(),
  isPinned: z.boolean().optional(),
});

/**
 * Everything a saved view remembers.
 *
 * Stored as one JSON document on `ProjectView.settings` and validated here on
 * every write, so "JSON column" never means "whatever the client sent".
 */
export const viewSettingsSchema = z.object({
  /** Ordered. Order in this array *is* the column order. */
  columns: z.array(viewColumnSchema).max(50).default([]),
  filters: filterGroupSchema.default({ combinator: 'AND', conditions: [] }),
  sorts: z.array(sortEntrySchema).max(MAX_SORTS_PER_VIEW).default([]),
  groupBy: fieldRefSchema.nullable().default(null),
  density: z.enum(['COMPACT', 'COMFORTABLE']).default('COMFORTABLE'),
  /** Board-only, ignored by other types. */
  cardFields: z.array(fieldRefSchema).max(20).optional(),
  showCompleted: z.boolean().default(true),
});
export type ViewSettingsInput = z.input<typeof viewSettingsSchema>;

export const createProjectViewSchema = z.object({
  name: z.string().trim().min(1, 'A name is required.').max(80),
  type: z.enum(PROJECT_VIEW_TYPES as unknown as [string, ...string[]]),
  scope: z.enum(PROJECT_VIEW_SCOPES as unknown as [string, ...string[]]).optional(),
  settings: viewSettingsSchema.optional(),
});
export type CreateProjectViewInput = z.input<typeof createProjectViewSchema>;

export const updateProjectViewSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    settings: viewSettingsSchema.optional(),
    isFavorite: z.boolean().optional(),
    position: z.number().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');
export type UpdateProjectViewInput = z.input<typeof updateProjectViewSchema>;
