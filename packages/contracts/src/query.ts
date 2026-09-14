import { CustomFieldType } from './colors.js';

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
    // Inclusive bounds, so "due this week" is `>= @startOfWeek` and
    // `<= @endOfWeek` rather than two off-by-one guesses.
    FilterOperator.GREATER_THAN_OR_EQUAL,
    FilterOperator.LESS_THAN_OR_EQUAL,
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
export const LIST_OPERATORS: readonly FilterOperator[] = [FilterOperator.IN, FilterOperator.NOT_IN];

export function operatorTakesValue(operator: FilterOperator): boolean {
  return !VALUELESS_OPERATORS.includes(operator);
}

export function operatorTakesList(operator: FilterOperator): boolean {
  return LIST_OPERATORS.includes(operator);
}

/** How the filter row words each operator. */
export const OPERATOR_LABEL: Record<FilterOperator, string> = {
  EQUALS: 'is',
  NOT_EQUALS: 'is not',
  CONTAINS: 'contains',
  NOT_CONTAINS: 'does not contain',
  IS_EMPTY: 'is empty',
  IS_NOT_EMPTY: 'is not empty',
  IN: 'is any of',
  NOT_IN: 'is none of',
  GREATER_THAN: 'is greater than',
  GREATER_THAN_OR_EQUAL: 'is on or after',
  LESS_THAN: 'is less than',
  LESS_THAN_OR_EQUAL: 'is on or before',
  BEFORE: 'is before',
  AFTER: 'is after',
};

/**
 * Dates a filter can name without naming a day.
 *
 * Resolved on the server at query time, so a saved "Due this week" is still
 * this week next Monday. Weeks start on Monday and boundaries are UTC
 * midnight; the reader's locale is a documented follow-up.
 */
export const RelativeDate = {
  TODAY: '@today',
  START_OF_WEEK: '@startOfWeek',
  END_OF_WEEK: '@endOfWeek',
  START_OF_NEXT_WEEK: '@startOfNextWeek',
  END_OF_NEXT_WEEK: '@endOfNextWeek',
} as const;
export type RelativeDate = (typeof RelativeDate)[keyof typeof RelativeDate];
export const RELATIVE_DATES = Object.values(RelativeDate);

export const RELATIVE_DATE_LABEL: Record<RelativeDate, string> = {
  '@today': 'today',
  '@startOfWeek': 'the start of this week',
  '@endOfWeek': 'the end of this week',
  '@startOfNextWeek': 'the start of next week',
  '@endOfNextWeek': 'the end of next week',
};

export function isRelativeDate(value: unknown): value is RelativeDate {
  return typeof value === 'string' && (RELATIVE_DATES as readonly string[]).includes(value);
}

const DAY_MS = 86_400_000;

/** The instant a token names, at UTC midnight, relative to `now`. */
export function resolveRelativeDate(token: RelativeDate, now: Date = new Date()): Date {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  // Monday is day 0 of the week here; JS counts Sunday as 0.
  const weekday = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today.getTime() - weekday * DAY_MS);

  switch (token) {
    case RelativeDate.TODAY:
      return today;
    case RelativeDate.START_OF_WEEK:
      return monday;
    case RelativeDate.END_OF_WEEK:
      return new Date(monday.getTime() + 6 * DAY_MS);
    case RelativeDate.START_OF_NEXT_WEEK:
      return new Date(monday.getTime() + 7 * DAY_MS);
    case RelativeDate.END_OF_NEXT_WEEK:
      return new Date(monday.getTime() + 13 * DAY_MS);
  }
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

/**
 * What the application knows about each built-in task property.
 *
 * The client used to carry two hand-written lists — a label map and a "fields
 * you may add" array — with nothing keeping them in step with the query
 * compiler that decides what can actually be filtered or sorted. A column
 * could be offered in the picker and then rejected by the API, and nothing but
 * a bug report would say so.
 *
 * This is the single answer, shared by both sides. The picker, the column
 * header, the filter builder and the group-by menu all read it, so a field that
 * cannot be sorted is never offered a sort.
 */
export interface SystemFieldDefinition {
  key: SystemField;
  label: string;
  description: string;
  /** Which editor and which filter operators apply. */
  dataType: CustomFieldType;
  isSortable: boolean;
  isFilterable: boolean;
  isGroupable: boolean;
  /** False for anything the server derives; the List view renders it read-only. */
  isEditable: boolean;
  /**
   * False for a field that is a real filter, sort or group key but never a
   * column: the title is the row's identity and always there, and a section
   * column repeats the card heading every row already sits under.
   */
  isColumn: boolean;
}

/** Ordered as the picker offers them: the ones people reach for first. */
export const SYSTEM_FIELD_CATALOG: readonly SystemFieldDefinition[] = [
  {
    key: SystemField.TITLE,
    label: 'Name',
    description: 'The task itself',
    dataType: CustomFieldType.TEXT,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: true,
    isColumn: false,
  },
  {
    key: SystemField.ASSIGNEE,
    label: 'Assignee',
    description: 'Who is doing the work',
    dataType: CustomFieldType.PEOPLE,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: true,
    isColumn: true,
  },
  {
    key: SystemField.STATUS,
    label: 'Status',
    description: 'Where the task has got to',
    dataType: CustomFieldType.SINGLE_SELECT,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: true,
    isColumn: true,
  },
  {
    key: SystemField.PRIORITY,
    label: 'Priority',
    description: 'How urgent the task is',
    dataType: CustomFieldType.SINGLE_SELECT,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: true,
    isColumn: true,
  },
  {
    key: SystemField.SECTION,
    label: 'Section',
    description: 'The column or heading it sits under',
    dataType: CustomFieldType.SINGLE_SELECT,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: true,
    isColumn: false,
  },
  {
    key: SystemField.DUE_DATE,
    label: 'Due date',
    description: 'When the task is expected to be finished',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: true,
    isColumn: true,
  },
  {
    key: SystemField.START_DATE,
    label: 'Start date',
    description: 'When work is meant to begin',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: true,
    isColumn: true,
  },
  {
    key: SystemField.ESTIMATE,
    label: 'Estimate',
    description: 'Expected effort, in minutes',
    dataType: CustomFieldType.NUMBER,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: true,
    isColumn: true,
  },
  {
    key: SystemField.COMPLETED_AT,
    label: 'Completed',
    description: 'When the task was finished',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: false,
    isColumn: true,
  },
  {
    key: SystemField.CREATED_BY,
    label: 'Created by',
    description: 'Who opened the task',
    dataType: CustomFieldType.PEOPLE,
    isSortable: true,
    isFilterable: true,
    isGroupable: true,
    isEditable: false,
    isColumn: true,
  },
  {
    key: SystemField.CREATED_AT,
    label: 'Created',
    description: 'When the task was opened',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: false,
    isColumn: true,
  },
  {
    key: SystemField.UPDATED_AT,
    label: 'Last modified',
    description: 'When the task last changed',
    dataType: CustomFieldType.DATE,
    isSortable: true,
    isFilterable: true,
    isGroupable: false,
    isEditable: false,
    isColumn: true,
  },
];

const SYSTEM_FIELD_BY_KEY = new Map(
  SYSTEM_FIELD_CATALOG.map((field) => [field.key as string, field]),
);

export function systemFieldDefinition(key: string): SystemFieldDefinition | undefined {
  return SYSTEM_FIELD_BY_KEY.get(key);
}

/**
 * The query kind of each custom field type, or `null` for a type a query
 * cannot reach — a formula is worked out after the rows are fetched, so it
 * can be neither filtered nor sorted nor grouped by. The compiler and every
 * picker read this one table, so a type the compiler refuses is never offered.
 */
export const CUSTOM_FIELD_KIND: Record<CustomFieldType, FieldKind | null> = {
  TEXT: 'TEXT',
  URL: 'TEXT',
  EMAIL: 'TEXT',
  NUMBER: 'NUMBER',
  RATING: 'NUMBER',
  DATE: 'DATE',
  CHECKBOX: 'BOOLEAN',
  SINGLE_SELECT: 'ENUM',
  MULTI_SELECT: 'ENUM',
  PEOPLE: 'PEOPLE',
  FORMULA: null,
};

export function customFieldKind(type: CustomFieldType): FieldKind | null {
  return CUSTOM_FIELD_KIND[type];
}

export function isQueryableCustomField(type: CustomFieldType): boolean {
  return CUSTOM_FIELD_KIND[type] !== null;
}

/** Custom field types a view may group by: a bounded set of values, one per row. */
export const GROUPABLE_CUSTOM_FIELD_TYPES: readonly CustomFieldType[] = [
  CustomFieldType.SINGLE_SELECT,
  CustomFieldType.PEOPLE,
];

export const SortDirection = {
  ASC: 'ASC',
  DESC: 'DESC',
} as const;
export type SortDirection = (typeof SortDirection)[keyof typeof SortDirection];

export const SORT_DIRECTION_LABEL: Record<SortDirection, string> = {
  ASC: 'Ascending',
  DESC: 'Descending',
};

export const RowDensity = {
  COMPACT: 'COMPACT',
  COMFORTABLE: 'COMFORTABLE',
} as const;
export type RowDensity = (typeof RowDensity)[keyof typeof RowDensity];

/** How many rows one page of the List view holds. */
export const LIST_VIEW_PAGE_SIZE = 100;
export const MAX_FILTERS_PER_VIEW = 20;
export const MAX_SORTS_PER_VIEW = 5;
