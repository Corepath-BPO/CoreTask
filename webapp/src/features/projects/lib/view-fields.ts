import {
  CUSTOM_FIELD_KIND,
  GROUPABLE_CUSTOM_FIELD_TYPES,
  SYSTEM_FIELD_CATALOG,
  customFieldRef,
  parseCustomFieldRef,
  systemFieldDefinition,
  type CustomFieldType,
  type FieldKind,
} from '@coretask/contracts';
import type { CustomField, ProjectFieldMetadata } from '@coretask/types';

/**
 * A field as the toolbar offers it: something a view can filter, sort or
 * group by, with the kind that decides its operators and its value control.
 */
export interface QueryableField {
  /** `assigneeId`, or `custom:<id>`. What the API is sent. */
  ref: string;
  label: string;
  kind: FieldKind;
  dataType: CustomFieldType;
  isSortable: boolean;
  isFilterable: boolean;
  isGroupable: boolean;
  origin: 'system' | 'custom';
  /** Present for a custom field, so a value control can read its options. */
  custom?: CustomField;
}

/**
 * Everything a view may ask the API about, from one table on each side.
 *
 * The system half comes from the contracts catalog the API filters by, so a
 * field offered here is one the compiler accepts. The custom half skips what
 * the compiler refuses — a formula has no kind — and what the project has
 * retired.
 */
export function queryableFields(metadata: ProjectFieldMetadata | undefined): QueryableField[] {
  const system: QueryableField[] = SYSTEM_FIELD_CATALOG.map((field) => ({
    ref: field.key,
    label: field.label,
    kind: kindOf(field.dataType) ?? 'TEXT',
    dataType: field.dataType,
    isSortable: field.isSortable,
    isFilterable: field.isFilterable,
    isGroupable: field.isGroupable,
    origin: 'system',
  }));

  const custom: QueryableField[] = (metadata?.customFields ?? [])
    .filter((field) => !field.isArchived)
    .flatMap((field) => {
      const kind = CUSTOM_FIELD_KIND[field.type];
      if (kind === null) return [];
      return [
        {
          ref: customFieldRef(field.id),
          label: field.name,
          kind,
          dataType: field.type,
          isSortable: true,
          isFilterable: true,
          isGroupable: (GROUPABLE_CUSTOM_FIELD_TYPES as readonly string[]).includes(field.type),
          origin: 'custom' as const,
          custom: field,
        },
      ];
    });

  return [...system, ...custom];
}

export const filterableFields = (metadata: ProjectFieldMetadata | undefined) =>
  queryableFields(metadata).filter((field) => field.isFilterable);
export const sortableFields = (metadata: ProjectFieldMetadata | undefined) =>
  queryableFields(metadata).filter((field) => field.isSortable);
export const groupableFields = (metadata: ProjectFieldMetadata | undefined) =>
  queryableFields(metadata).filter((field) => field.isGroupable);

/** The field a reference names, or undefined once it has been removed. */
export function findQueryableField(
  ref: string,
  metadata: ProjectFieldMetadata | undefined,
): QueryableField | undefined {
  return queryableFields(metadata).find((field) => field.ref === ref);
}

/**
 * The words for a field reference, wherever it appears — a filter row, a sort
 * chip, a group heading. A removed custom field reads as such rather than as
 * its id.
 */
export function fieldLabel(ref: string, metadata: ProjectFieldMetadata | undefined): string {
  const customId = parseCustomFieldRef(ref);
  if (customId) {
    const field = metadata?.customFields.find((entry) => entry.id === customId);
    return field?.name ?? (metadata ? 'Removed field' : '');
  }
  return systemFieldDefinition(ref)?.label ?? ref;
}

function kindOf(type: CustomFieldType): FieldKind | null {
  return CUSTOM_FIELD_KIND[type];
}
