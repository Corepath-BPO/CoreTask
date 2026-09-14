import { CustomFieldType, SystemField, parseCustomFieldRef } from '@coretask/contracts';
import type { ProjectFieldMetadata, UpdateWorkItemPayload, ViewSettings } from '@coretask/types';

import { isTicketRow, type WorkItemRow } from '@/features/work-items/lib/work-item-row';

import type { RowGroup } from './group-rows';

/**
 * Whether dragging within a group may reorder rows.
 *
 * Only while nothing else decides the order: a sort owns it, and a grouping
 * other than by section has no position to write to. Dragging *between*
 * groups stays on, because that means "give it this value", which is a
 * different act from reordering.
 */
export function isManualOrder(settings: Pick<ViewSettings, 'sorts' | 'groupBy'>): boolean {
  return (
    settings.sorts.length === 0 && (settings.groupBy ?? SystemField.SECTION) === SystemField.SECTION
  );
}

export type GroupValueChange =
  | { kind: 'move'; sectionId: string | null }
  | { kind: 'update'; payload: UpdateWorkItemPayload }
  | { kind: 'field'; fieldId: string; payload: Record<string, unknown> }
  | { kind: 'refused'; reason: string };

/**
 * What dropping a row into a group means.
 *
 * A section group is a move, as it always was. Any other group stands for a
 * value, and landing there sets it: status, priority, assignee, or the custom
 * field the view groups by. A ticket holds no custom-field values, so a drop
 * that would set one is refused with a reason the toast can show.
 */
export function groupValueChange(
  groupBy: string | null,
  group: RowGroup,
  row: WorkItemRow,
  metadata: ProjectFieldMetadata | undefined,
): GroupValueChange | null {
  if (!groupBy || groupBy === SystemField.SECTION) {
    return group.kind === 'section' ? { kind: 'move', sectionId: group.key } : null;
  }

  const customId = parseCustomFieldRef(groupBy);
  if (customId) {
    if (isTicketRow(row)) {
      return { kind: 'refused', reason: 'Tickets do not hold custom field values.' };
    }
    const field = metadata?.customFields.find((entry) => entry.id === customId);
    if (field?.type === CustomFieldType.PEOPLE) {
      return {
        kind: 'field',
        fieldId: customId,
        payload: { userIds: group.key ? [group.key] : [] },
      };
    }
    return {
      kind: 'field',
      fieldId: customId,
      payload: { optionIds: group.key ? [group.key] : [] },
    };
  }

  switch (groupBy) {
    case SystemField.STATUS:
      if (!group.key) return { kind: 'refused', reason: 'A row always has a status.' };
      return { kind: 'update', payload: { statusId: group.key } };
    case SystemField.PRIORITY:
      if (!group.key) return { kind: 'refused', reason: 'A row always has a priority.' };
      return { kind: 'update', payload: { priorityId: group.key } };
    case SystemField.ASSIGNEE:
      return { kind: 'update', payload: { assigneeIds: group.key ? [group.key] : [] } };
    case SystemField.CREATED_BY:
      return { kind: 'refused', reason: 'Who created a task cannot be changed.' };
    default:
      return null;
  }
}
