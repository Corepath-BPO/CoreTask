/**
 * The contract a saved view uses to describe what it shows.
 *
 * Shared by client and server so the filter builder can only offer combinations
 * the API will accept. The server still validates — this is what makes the two
 * agree, not what makes it safe.
 */

export const FilterOperator = {
  EQUALS: 'EQUALS',
  NOT_EQUALS: 'NOT_EQUALS',
  CONTAINS: 'CONTAINS',
  NOT_CONTAINS: 'NOT_CONTAINS',
  IS_EMPTY: 'IS_EMPTY',
  IS_NOT_EMPTY: 'IS_NOT_EMPTY',
  IN: 'IN',
  NOT_IN: 'NOT_IN',
  GREATER_THAN: 'GREATER_THAN',
  GREATER_THAN_OR_EQUAL: 'GREATER_THAN_OR_EQUAL',
  LESS_THAN: 'LESS_THAN',
  LESS_THAN_OR_EQUAL: 'LESS_THAN_OR_EQUAL',
  BEFORE: 'BEFORE',
  AFTER: 'AFTER',
} as const;
export type FilterOperator = (typeof FilterOperator)[keyof typeof FilterOperator];
export const FILTER_OPERATORS = Object.values(FilterOperator);

/**
 * How a field behaves in a query, independent of what it is called.
 *
 * Operators are offered per *kind*, not per field, so adding a field costs
 * nothing and a custom field is filterable the moment it is created — which is
 * the requirement that creating a field must never need frontend changes.
 */
export const FieldKind = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  BOOLEAN: 'BOOLEAN',
  /** A fixed set of ids: status, priority, section, a select option. */
  ENUM: 'ENUM',
  /** One or more user ids. */
  PEOPLE: 'PEOPLE',
} as const;
export type FieldKind = (typeof FieldKind)[keyof typeof FieldKind];

/**
 * Which operators each kind accepts.
 *
 * `IS_EMPTY`/`IS_NOT_EMPTY` are on every kind because "unset" is a question
 * worth asking of anything. Ordering matters — the client renders these in
 * order, and the first is the default.
 */
export const OPERATORS_BY_KIND: Record<FieldKind, readonly FilterOperator[]> = {
  TEXT: [
    FilterOperator.CONTAINS,
    FilterOperator.NOT_CONTAINS,
    FilterOperator.EQUALS,
    FilterOperator.NOT_EQUALS,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
  NUMBER: [
    FilterOperator.EQUALS,
    FilterOperator.NOT_EQUALS,
    FilterOperator.GREATER_THAN,
    FilterOperator.GREATER_THAN_OR_EQUAL,
    FilterOperator.LESS_THAN,
    FilterOperator.LESS_THAN_OR_EQUAL,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
  DATE: [
    FilterOperator.BEFORE,
    FilterOperator.AFTER,
    FilterOperator.EQUALS,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
  BOOLEAN: [FilterOperator.EQUALS, FilterOperator.IS_EMPTY, FilterOperator.IS_NOT_EMPTY],
  ENUM: [
    FilterOperator.IN,
    FilterOperator.NOT_IN,
    FilterOperator.EQUALS,
    FilterOperator.NOT_EQUALS,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
  PEOPLE: [
    FilterOperator.IN,
    FilterOperator.NOT_IN,
    FilterOperator.IS_EMPTY,
    FilterOperator.IS_NOT_EMPTY,
  ],
};

/** Operators that take no value at all. */
export const VALUELESS_OPERATORS: readonly FilterOperator[] = [
  FilterOperator.IS_EMPTY,
  FilterOperator.IS_NOT_EMPTY,
];

/** Operators whose value is a list. */
export const LIST_OPERATORS: readonly FilterOperator[] = [
  FilterOperator.IN,
  FilterOperator.NOT_IN,
];

export function operatorTakesValue(operator: FilterOperator): boolean {
  return !VALUELESS_OPERATORS.includes(operator);
}

export function operatorTakesList(operator: FilterOperator): boolean {
  return LIST_OPERATORS.includes(operator);
}

/**
 * System fields a view can filter, sort or group by.
 *
 * A closed set on purpose: these map to real Task columns, and the compiler
 * refuses anything not named here. A custom field is addressed as
 * `custom:<fieldId>` instead, which is what keeps user-defined names out of
 * anywhere near a query path.
 */
export const SystemField = {
  TITLE: 'title',
  STATUS: 'status',
  PRIORITY: 'priority',
  SECTION: 'sectionId',
  ASSIGNEE: 'assigneeId',
  CREATED_BY: 'createdById',
  DUE_DATE: 'dueDate',
  START_DATE: 'startDate',
  COMPLETED_AT: 'completedAt',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
  ESTIMATE: 'estimatedMinutes',
} as const;
export type SystemField = (typeof SystemField)[keyof typeof SystemField];
export const SYSTEM_FIELDS = Object.values(SystemField);

export const SYSTEM_FIELD_KIND: Record<SystemField, FieldKind> = {
  title: 'TEXT',
  status: 'ENUM',
  priority: 'ENUM',
  sectionId: 'ENUM',
  assigneeId: 'PEOPLE',
  createdById: 'PEOPLE',
  dueDate: 'DATE',
  startDate: 'DATE',
  completedAt: 'DATE',
  createdAt: 'DATE',
  updatedAt: 'DATE',
  estimatedMinutes: 'NUMBER',
};

/** Prefix marking a custom-field reference in a filter, sort or grouping. */
export const CUSTOM_FIELD_PREFIX = 'custom:';

export function customFieldRef(fieldId: string): string {
  return `${CUSTOM_FIELD_PREFIX}${fieldId}`;
}

/** Returns the field id when `ref` addresses a custom field, else null. */
export function parseCustomFieldRef(ref: string): string | null {
  return ref.startsWith(CUSTOM_FIELD_PREFIX) ? ref.slice(CUSTOM_FIELD_PREFIX.length) : null;
}

export function isSystemField(ref: string): ref is SystemField {
  return (SYSTEM_FIELDS as readonly string[]).includes(ref);
}

/** Fields a view may group rows by. Grouping needs a bounded set of values. */
export const GROUPABLE_SYSTEM_FIELDS: readonly SystemField[] = [
  SystemField.SECTION,
  SystemField.STATUS,
  SystemField.PRIORITY,
  SystemField.ASSIGNEE,
];

export const SortDirection = {
  ASC: 'ASC',
  DESC: 'DESC',
} as const;
export type SortDirection = (typeof SortDirection)[keyof typeof SortDirection];

export const RowDensity = {
  COMPACT: 'COMPACT',
  COMFORTABLE: 'COMFORTABLE',
} as const;
export type RowDensity = (typeof RowDensity)[keyof typeof RowDensity];

/** How many rows one page of the List view holds. */
export const LIST_VIEW_PAGE_SIZE = 100;
export const MAX_FILTERS_PER_VIEW = 20;
export const MAX_SORTS_PER_VIEW = 5;
