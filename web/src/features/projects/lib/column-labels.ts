import { SystemField } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';

/**
 * Human labels for the system columns a List view can show.
 *
 * In its own module rather than beside the table: a file that exports both a
 * component and a constant defeats fast refresh, and both the table and the
 * column manager need these.
 */
export const COLUMN_LABEL: Record<string, string> = {
  [SystemField.TITLE]: 'Task',
  [SystemField.ASSIGNEE]: 'Assignee',
  [SystemField.PRIORITY]: 'Priority',
  [SystemField.STATUS]: 'Status',
  [SystemField.DUE_DATE]: 'Due date',
  [SystemField.SECTION]: 'Section',
  [SystemField.CREATED_BY]: 'Created by',
  [SystemField.START_DATE]: 'Start date',
  [SystemField.COMPLETED_AT]: 'Completed',
  [SystemField.CREATED_AT]: 'Created',
  [SystemField.UPDATED_AT]: 'Updated',
  [SystemField.ESTIMATE]: 'Estimate',
};

/**
 * The label a column shows in the header.
 *
 * A saved view outlives the fields it names: delete a custom field and its
 * column is still in the stored settings. That used to put the raw reference —
 * `custom:019fd248-…` — in the header, which tells a reader nothing and puts an
 * internal id on screen. A deleted field gets a plain label instead, matching
 * the `—` its cells already render.
 */
export function columnLabel(field: string, metadata: ProjectFieldMetadata | undefined): string {
  if (COLUMN_LABEL[field]) return COLUMN_LABEL[field];

  if (field.startsWith('custom:')) {
    const customId = field.slice('custom:'.length);
    const custom = metadata?.customFields.find((entry) => entry.id === customId);

    // Undefined metadata means "not loaded yet", which is not the same as a
    // field that is gone — an empty header beats flashing "Deleted field".
    if (!metadata) return '';

    return custom?.name ?? 'Deleted field';
  }

  return field;
}
