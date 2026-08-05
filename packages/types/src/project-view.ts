import type {
  CustomFieldType,
  FilterOperator,
  ProjectViewScope,
  ProjectViewType,
  RowDensity,
  SortDirection,
} from '@coretask/contracts';

import type { UserRef } from './work-items.js';

export interface ViewFilterCondition {
  field: string;
  operator: FilterOperator;
  value?: string | number | boolean | string[] | null;
}

export interface ViewFilterGroup {
  combinator: 'AND';
  conditions: ViewFilterCondition[];
}

export interface ViewSort {
  field: string;
  direction: SortDirection;
}

export interface ViewColumn {
  field: string;
  width?: number;
  isPinned?: boolean;
}

/** Everything a saved view remembers about how it looks. */
export interface ViewSettings {
  /** Ordered — position in this array is the column order. */
  columns: ViewColumn[];
  filters: ViewFilterGroup;
  sorts: ViewSort[];
  groupBy: string | null;
  density: RowDensity;
  cardFields?: string[];
  showCompleted: boolean;
}

export interface ProjectView {
  id: string;
  projectId: string;
  name: string;
  type: ProjectViewType;
  scope: ProjectViewScope;
  /** Set only for personal views. */
  ownerUserId: string | null;
  isDefault: boolean;
  isFavorite: boolean;
  position: number;
  settings: ViewSettings;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectViewPayload {
  name: string;
  type: ProjectViewType;
  scope?: ProjectViewScope;
  settings?: Partial<ViewSettings>;
}

export interface UpdateProjectViewPayload {
  name?: string;
  settings?: Partial<ViewSettings>;
  isFavorite?: boolean;
  position?: number;
}

// ---------------------------------------------------------------------------
// Custom fields
// ---------------------------------------------------------------------------

export interface CustomFieldOption {
  id: string;
  label: string;
  colorToken: string;
  customColor: string | null;
  position: number;
  isArchived: boolean;
}

export interface CustomField {
  id: string;
  projectId: string;
  name: string;
  description: string | null;
  type: CustomFieldType;
  isRequired: boolean;
  isArchived: boolean;
  position: number;
  /**
   * Type-specific configuration, e.g. `{ textMode: 'LONG' }`.
   *
   * Always complete: the API fills in every default on write, so a reader never
   * has to know what a missing key used to mean.
   */
  settings: Record<string, unknown>;
  /** Present only for select types. */
  options: CustomFieldOption[];
  createdAt: string;
  updatedAt: string;
}

/**
 * One task's value for one field, in whichever shape the type uses.
 *
 * A discriminated union would be tidier, but the client renders these by
 * looking up the field definition anyway — and a union would mean a type guard
 * at every cell for no additional safety.
 */
export interface TaskCustomFieldValue {
  customFieldId: string;
  text: string | null;
  number: number | null;
  date: string | null;
  checkbox: boolean | null;
  optionIds: string[];
  userIds: string[];
}

/** A task as the List view receives it: the task plus its field values. */
export interface TaskWithCustomFields {
  customFieldValues: TaskCustomFieldValue[];
}

export interface CreateCustomFieldPayload {
  name: string;
  type: CustomFieldType;
  description?: string;
  isRequired?: boolean;
  settings?: Record<string, unknown>;
  options?: { label: string; colorToken?: string }[];
}

export interface UpdateCustomFieldPayload {
  name?: string;
  settings?: Record<string, unknown>;
  description?: string | null;
  isRequired?: boolean;
  isArchived?: boolean;
  position?: number;
}

export interface SetCustomFieldValuePayload {
  text?: string | null;
  number?: number | null;
  date?: string | null;
  checkbox?: boolean | null;
  optionIds?: string[];
  userIds?: string[];
}

/** What the Fields menu and the filter builder need to render themselves. */
export interface ProjectFieldMetadata {
  customFields: CustomField[];
  statuses: { id: string; name: string; category: string; colorToken: string }[];
  priorities: { id: string; name: string; level: number; colorToken: string }[];
  sections: { id: string; name: string }[];
  members: UserRef[];
}
