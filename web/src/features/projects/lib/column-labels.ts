import { SystemField } from '@coretask/contracts';
import type { ProjectFieldMetadata } from '@coretask/types';

import { textWidth } from '@/lib/text-width';

/**
 * Human labels for the system columns a List view can show.
 *
 * In its own module rather than beside the table: a file that exports both a
 * component and a constant defeats fast refresh, and both the table and the
 * column manager need these.
 */
export const COLUMN_LABEL: Record<string, string> = {
  // "Name", as Asana heads the column — the rows hold tickets too.
  [SystemField.TITLE]: 'Name',
  [SystemField.ASSIGNEE]: 'Assignee',
  [SystemField.PRIORITY]: 'Priority',
  [SystemField.STATUS]: 'Status',
  [SystemField.DUE_DATE]: 'Due date',
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
 * the `-` its cells already render.
 */
/**
 * The narrowest a column may draw or drag: its full label plus the header's
 * chrome, never under 90px. Flooring only the first word left every
 * multi-word field reading "Did w…" — a header that labels nothing. Capped
 * so one long name cannot force a column wide open; past the cap the header
 * truncates and its tooltip carries the rest.
 */
export function columnMinWidth(field: string, metadata: ProjectFieldMetadata | undefined): number {
  const label = columnLabel(field, metadata);
  // The chrome around the label, measured in the rendered header: the cell's
  // padding (24px), the pin button (16px — hidden by opacity, so it still
  // holds its space), the gap (4px) and the gridline, plus a little slack.
  return Math.min(220, Math.max(90, Math.ceil(textWidth(label, '500 12px')) + 48));
}

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
