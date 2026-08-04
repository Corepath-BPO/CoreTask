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

/** Falls back to the custom field's own name, then to the raw reference. */
export function columnLabel(field: string, metadata: ProjectFieldMetadata | undefined): string {
  if (COLUMN_LABEL[field]) return COLUMN_LABEL[field];

  const customId = field.startsWith('custom:') ? field.slice('custom:'.length) : null;
  const custom = customId ? metadata?.customFields.find((entry) => entry.id === customId) : null;

  return custom?.name ?? field;
}
