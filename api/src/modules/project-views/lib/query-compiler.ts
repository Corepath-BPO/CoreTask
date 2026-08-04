import {
  CustomFieldType,
  FilterOperator,
  SYSTEM_FIELD_KIND,
  SystemField,
  isSystemField,
  parseCustomFieldRef,
  type FieldKind,
  type SortDirection,
} from '@coretask/contracts';
import type { Prisma } from '@prisma/client';

import { AppException } from '../../../common/exceptions/app.exception';

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value?: string | number | boolean | string[] | null;
}

export interface SortEntry {
  field: string;
  direction: SortDirection;
}

/** The custom fields of the project being queried, keyed by id. */
export type CustomFieldMap = Map<string, { id: string; type: CustomFieldType }>;

/**
 * Turns a validated filter contract into a Prisma `where`.
 *
 * Nothing here builds SQL, and nothing interpolates a user value into a query
 * string. Every field name is resolved against a closed set — the twelve system
 * fields, or a custom field id that must already exist in this project — and
 * every value reaches PostgreSQL as a bound parameter through Prisma. A field
 * reference the compiler does not recognise is refused rather than passed
 * through, which is what stops `?filter=...` becoming an injection surface.
 */
export function compileFilters(
  conditions: readonly FilterCondition[],
  customFields: CustomFieldMap,
): Prisma.TaskWhereInput[] {
  return conditions.map((condition) => compileCondition(condition, customFields));
}

function compileCondition(
  condition: FilterCondition,
  customFields: CustomFieldMap,
): Prisma.TaskWhereInput {
  const customFieldId = parseCustomFieldRef(condition.field);

  if (customFieldId) {
    const field = customFields.get(customFieldId);

    if (!field) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'That filter refers to a field this project does not have.',
      );
    }

    return compileCustomField(field, condition);
  }

  if (!isSystemField(condition.field)) {
    throw AppException.badRequest('BAD_REQUEST', `Cannot filter by "${condition.field}".`);
  }

  return compileSystemField(condition.field, condition);
}

function compileSystemField(
  field: SystemField,
  condition: FilterCondition,
): Prisma.TaskWhereInput {
  const kind = SYSTEM_FIELD_KIND[field];
  const clause = buildClause(kind, condition);

  return { [field]: clause } as Prisma.TaskWhereInput;
}

/**
 * Filters through the value table rather than on the task row.
 *
 * `some` and not `every`: a task with no value for the field must not match an
 * equality filter, and `every` is vacuously true over an empty relation — which
 * would quietly return every unset task for `Department equals Support`.
 * "Unset" is asked for explicitly with IS_EMPTY, which is the one case that
 * does invert to `none`.
 */
function compileCustomField(
  field: { id: string; type: CustomFieldType },
  condition: FilterCondition,
): Prisma.TaskWhereInput {
  const column = VALUE_COLUMN[field.type];
  const kind = CUSTOM_FIELD_KIND[field.type];

  if (condition.operator === FilterOperator.IS_EMPTY) {
    return {
      OR: [
        { customFieldValues: { none: { customFieldId: field.id } } },
        { customFieldValues: { some: { customFieldId: field.id, ...emptyClause(column) } } },
      ],
    };
  }

  if (condition.operator === FilterOperator.IS_NOT_EMPTY) {
    return {
      customFieldValues: { some: { customFieldId: field.id, NOT: emptyClause(column) } },
    };
  }

  // Array-valued fields hold ids, so membership rather than comparison.
  if (column === 'optionIds' || column === 'userIds') {
    const values = toStringList(condition.value);
    const clause =
      condition.operator === FilterOperator.NOT_IN || condition.operator === FilterOperator.NOT_EQUALS
        ? { NOT: { [column]: { hasSome: values } } }
        : { [column]: { hasSome: values } };

    return { customFieldValues: { some: { customFieldId: field.id, ...clause } } };
  }

  return {
    customFieldValues: {
      some: { customFieldId: field.id, [column]: buildClause(kind, condition) },
    },
  };
}

/** How each operator becomes a Prisma filter, per kind. */
function buildClause(kind: FieldKind, condition: FilterCondition): unknown {
  const { operator, value } = condition;

  switch (operator) {
    case FilterOperator.IS_EMPTY:
      return null;
    case FilterOperator.IS_NOT_EMPTY:
      return { not: null };
    case FilterOperator.EQUALS:
      return coerce(kind, value);
    case FilterOperator.NOT_EQUALS:
      return { not: coerce(kind, value) };
    case FilterOperator.CONTAINS:
      // Case-insensitive because nobody searching a title means it literally.
      return { contains: String(value), mode: 'insensitive' };
    case FilterOperator.NOT_CONTAINS:
      return { not: { contains: String(value), mode: 'insensitive' } };
    case FilterOperator.IN:
      return { in: toStringList(value) };
    case FilterOperator.NOT_IN:
      return { notIn: toStringList(value) };
    case FilterOperator.GREATER_THAN:
    case FilterOperator.AFTER:
      return { gt: coerce(kind, value) };
    case FilterOperator.GREATER_THAN_OR_EQUAL:
      return { gte: coerce(kind, value) };
    case FilterOperator.LESS_THAN:
    case FilterOperator.BEFORE:
      return { lt: coerce(kind, value) };
    case FilterOperator.LESS_THAN_OR_EQUAL:
      return { lte: coerce(kind, value) };
    default:
      throw AppException.badRequest('BAD_REQUEST', `Unsupported operator "${String(operator)}".`);
  }
}

/**
 * Turns a JSON value into what the column expects.
 *
 * A date arrives as an ISO string and has to become a `Date`; a number arrives
 * as a number but may arrive as a string from a query parameter. Getting this
 * wrong produces a Prisma error at runtime rather than a useful message, so the
 * failures are turned into 400s here.
 */
function coerce(kind: FieldKind, value: unknown): unknown {
  if (value === null || value === undefined) return null;

  if (kind === 'DATE') {
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      throw AppException.badRequest('BAD_REQUEST', `"${String(value)}" is not a valid date.`);
    }
    return date;
  }

  if (kind === 'NUMBER') {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(parsed)) {
      throw AppException.badRequest('BAD_REQUEST', `"${String(value)}" is not a number.`);
    }
    return parsed;
  }

  if (kind === 'BOOLEAN') return value === true || value === 'true';

  return String(value);
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === null || value === undefined) return [];
  return [String(value)];
}

/** What "empty" means for each storage column. */
function emptyClause(column: ValueColumn): Record<string, unknown> {
  if (column === 'optionIds' || column === 'userIds') return { [column]: { isEmpty: true } };
  return { [column]: null };
}

type ValueColumn =
  | 'textValue'
  | 'numberValue'
  | 'dateValue'
  | 'booleanValue'
  | 'optionIds'
  | 'userIds';

/** Which typed column each field type stores its value in. */
const VALUE_COLUMN: Record<CustomFieldType, ValueColumn> = {
  TEXT: 'textValue',
  URL: 'textValue',
  EMAIL: 'textValue',
  NUMBER: 'numberValue',
  DATE: 'dateValue',
  CHECKBOX: 'booleanValue',
  SINGLE_SELECT: 'optionIds',
  MULTI_SELECT: 'optionIds',
  PEOPLE: 'userIds',
};

const CUSTOM_FIELD_KIND: Record<CustomFieldType, FieldKind> = {
  TEXT: 'TEXT',
  URL: 'TEXT',
  EMAIL: 'TEXT',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  CHECKBOX: 'BOOLEAN',
  SINGLE_SELECT: 'ENUM',
  MULTI_SELECT: 'ENUM',
  PEOPLE: 'PEOPLE',
};

/**
 * Turns sort entries into a Prisma `orderBy`.
 *
 * Always ends with `position` then `id`. Without a deterministic tail two rows
 * with the same sort value can come back in a different order on each page, so
 * paging silently repeats or skips them — the classic unstable-pagination bug.
 *
 * Custom fields are deliberately not sortable here: ordering by a related row
 * needs either a join Prisma cannot express in `orderBy` or a raw query, and a
 * silently-ignored sort is worse than one the UI never offers.
 */
export function compileSorts(sorts: readonly SortEntry[]): Prisma.TaskOrderByWithRelationInput[] {
  const compiled: Prisma.TaskOrderByWithRelationInput[] = [];

  for (const sort of sorts) {
    if (!isSystemField(sort.field)) continue;

    const direction = sort.direction === 'DESC' ? 'desc' : 'asc';
    compiled.push({ [sort.field]: direction } as Prisma.TaskOrderByWithRelationInput);
  }

  compiled.push({ position: 'asc' }, { id: 'asc' });
  return compiled;
}
