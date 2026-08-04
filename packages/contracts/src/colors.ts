/**
 * Semantic colour tokens.
 *
 * A token is a *name a user picked*, stored in the database against a status, a
 * priority, a select option or an automation node. It is deliberately not a
 * Tailwind class: class strings in the database would tie stored data to a CSS
 * framework, and Tailwind's JIT cannot see a class that only exists in a row.
 *
 * The mapping from token to actual colour lives in one place on the client
 * (`web/src/features/colors`), which is what lets light and dark mode differ
 * without every consumer knowing.
 */

export const COLOR_TOKENS = [
  'slate',
  'gray',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const;

export type ColorToken = (typeof COLOR_TOKENS)[number];

export const DEFAULT_COLOR_TOKEN: ColorToken = 'gray';

// Custom hex colours reuse `HEX_COLOR_PATTERN` from `limits.ts`, which teams
// already validate against. One pattern, so "what counts as a colour" cannot
// come to mean two different things in the same codebase.

export function isColorToken(value: unknown): value is ColorToken {
  return typeof value === 'string' && (COLOR_TOKENS as readonly string[]).includes(value);
}

/**
 * Semantic meaning of a status, preserved when its name changes.
 *
 * Renaming "In Progress" to "Working" must not stop it counting as active work
 * on a dashboard. The name is for people; the category is what code reasons
 * about, and it is the reason a rollup does not break when a workspace
 * customises its own vocabulary.
 */
export const StatusCategory = {
  NOT_STARTED: 'NOT_STARTED',
  ACTIVE: 'ACTIVE',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type StatusCategory = (typeof StatusCategory)[keyof typeof StatusCategory];
export const STATUS_CATEGORIES = Object.values(StatusCategory);

/** Categories that mean "no longer active work" — used for rollups. */
export const CLOSED_STATUS_CATEGORIES: readonly StatusCategory[] = [
  StatusCategory.COMPLETED,
  StatusCategory.CANCELLED,
  StatusCategory.ARCHIVED,
];

/** Default colour for each category, used when seeding a workspace. */
export const STATUS_CATEGORY_COLOR: Record<StatusCategory, ColorToken> = {
  NOT_STARTED: 'slate',
  ACTIVE: 'blue',
  BLOCKED: 'red',
  COMPLETED: 'emerald',
  CANCELLED: 'gray',
  ARCHIVED: 'slate',
};

/**
 * The statuses every new workspace starts with.
 *
 * Deliberately a superset of the legacy `TaskStatus` enum plus `Waiting`, so a
 * backfill can map every existing task onto one of these by name.
 */
export const DEFAULT_STATUS_DEFINITIONS: readonly {
  name: string;
  slug: string;
  category: StatusCategory;
  colorToken: ColorToken;
  isDefault: boolean;
}[] = [
  { name: 'Backlog', slug: 'backlog', category: 'NOT_STARTED', colorToken: 'slate', isDefault: false },
  { name: 'To Do', slug: 'todo', category: 'NOT_STARTED', colorToken: 'gray', isDefault: true },
  { name: 'In Progress', slug: 'in-progress', category: 'ACTIVE', colorToken: 'blue', isDefault: false },
  { name: 'In Review', slug: 'in-review', category: 'ACTIVE', colorToken: 'violet', isDefault: false },
  { name: 'Waiting', slug: 'waiting', category: 'BLOCKED', colorToken: 'amber', isDefault: false },
  { name: 'Blocked', slug: 'blocked', category: 'BLOCKED', colorToken: 'red', isDefault: false },
  { name: 'Done', slug: 'done', category: 'COMPLETED', colorToken: 'emerald', isDefault: false },
  { name: 'Cancelled', slug: 'cancelled', category: 'CANCELLED', colorToken: 'gray', isDefault: false },
];

/**
 * The priorities every new workspace starts with.
 *
 * `level` is the sort key and is what comparisons use, so renaming or
 * reordering never changes what "higher priority" means.
 */
export const DEFAULT_PRIORITY_DEFINITIONS: readonly {
  name: string;
  level: number;
  colorToken: ColorToken;
  isDefault: boolean;
}[] = [
  { name: 'None', level: 0, colorToken: 'gray', isDefault: true },
  { name: 'Low', level: 1, colorToken: 'blue', isDefault: false },
  { name: 'Medium', level: 2, colorToken: 'amber', isDefault: false },
  { name: 'High', level: 3, colorToken: 'orange', isDefault: false },
  { name: 'Critical', level: 4, colorToken: 'red', isDefault: false },
];

/** Colour per automation node type, so a rule reads at a glance. */
export const AUTOMATION_NODE_COLOR = {
  TRIGGER: 'blue',
  CONDITION: 'violet',
  ACTION: 'emerald',
  BRANCH: 'cyan',
  DELAY: 'amber',
} as const satisfies Record<string, ColorToken>;

/** Colour per automation run state. */
export const AUTOMATION_STATE_COLOR = {
  ACTIVE: 'emerald',
  DRAFT: 'gray',
  PAUSED: 'amber',
  RUNNING: 'blue',
  COMPLETED: 'emerald',
  FAILED: 'red',
  PARTIALLY_FAILED: 'orange',
  DISABLED: 'slate',
} as const satisfies Record<string, ColorToken>;

/** Custom field types implemented today. Future types are added here first. */
export const CustomFieldType = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  CHECKBOX: 'CHECKBOX',
  SINGLE_SELECT: 'SINGLE_SELECT',
  MULTI_SELECT: 'MULTI_SELECT',
  PEOPLE: 'PEOPLE',
  URL: 'URL',
  EMAIL: 'EMAIL',
} as const;
export type CustomFieldType = (typeof CustomFieldType)[keyof typeof CustomFieldType];
export const CUSTOM_FIELD_TYPES = Object.values(CustomFieldType);

/** Field types that carry `CustomFieldOption` rows. */
export const SELECT_FIELD_TYPES: readonly CustomFieldType[] = [
  CustomFieldType.SINGLE_SELECT,
  CustomFieldType.MULTI_SELECT,
];

export const ProjectViewType = {
  LIST: 'LIST',
  BOARD: 'BOARD',
  CALENDAR: 'CALENDAR',
  TIMELINE: 'TIMELINE',
  DASHBOARD: 'DASHBOARD',
} as const;
export type ProjectViewType = (typeof ProjectViewType)[keyof typeof ProjectViewType];
export const PROJECT_VIEW_TYPES = Object.values(ProjectViewType);

/** View types with a real implementation; the rest are future-ready. */
export const IMPLEMENTED_VIEW_TYPES: readonly ProjectViewType[] = [
  ProjectViewType.LIST,
  ProjectViewType.BOARD,
];

export const ProjectViewScope = {
  /** Visible to every project member. */
  PROJECT: 'PROJECT',
  /** Visible only to its owner. */
  PERSONAL: 'PERSONAL',
} as const;
export type ProjectViewScope = (typeof ProjectViewScope)[keyof typeof ProjectViewScope];
export const PROJECT_VIEW_SCOPES = Object.values(ProjectViewScope);
