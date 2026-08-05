import { WorkItemType } from '@coretask/contracts';
import type { ProjectWorkItem, Task, TaskCustomFieldValue } from '@coretask/types';

/**
 * A work item in the shape the List already renders, plus what it is.
 *
 * The List's cells were written against `Task` and there are a dozen of them.
 * Rewriting every one to take `ProjectWorkItem` in the same change that
 * introduces tickets to the grid would make one large diff out of two separate
 * risks, so the conversion happens here instead — at the boundary, in one
 * place, where it can be read and later deleted.
 *
 * This is a seam, not a destination. `workItem` is carried alongside so a cell
 * that needs the truth can ask for it rather than inferring it from a `Task`
 * that a ticket is only pretending to be — the status cell does exactly that,
 * because "In Progress" for a task and "In progress" for a ticket are different
 * values from different vocabularies with different consequences.
 */
export interface WorkItemRow extends Task {
  /** The List reads values off the row; the query supplies them per item. */
  customFieldValues: TaskCustomFieldValue[];
  workItem: ProjectWorkItem;
}

/** True when this row is backed by a ticket, so a cell can switch on it. */
export function isTicketRow(row: Task): row is WorkItemRow {
  return (row as WorkItemRow).workItem?.type === WorkItemType.TICKET;
}

/**
 * The state id the API will accept back for this row.
 *
 * Tasks report a definition id or a legacy enum; tickets always report an enum.
 * Both are handed straight back on save — see the work-item validation schema,
 * which accepts either rather than insisting on a uuid.
 */
export function rowStatusId(row: Task): string | null {
  return (row as WorkItemRow).workItem?.status?.id ?? null;
}

export function rowPriorityId(row: Task): string | null {
  return (row as WorkItemRow).workItem?.priority?.id ?? null;
}

export function toWorkItemRow(item: ProjectWorkItem): WorkItemRow {
  return {
    workItem: item,

    id: item.id,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    sectionId: item.sectionId,
    parentTaskId: item.parentId,
    title: item.title,
    description: item.description,

    /*
     * The raw enum from either kind, never the resolved state's id.
     *
     * The resolved `status` is for display: for a task with a definition its id
     * is a uuid, and the grid's badges render a fixed set of enum values — so
     * using it printed `019fce6b-…` in the status column. Both kinds carry their
     * raw value for exactly this, and a cell that wants the richer version reads
     * `workItem.status`.
     */
    status: item.details.rawStatus as Task['status'],
    priority: item.details.rawPriority as Task['priority'],

    position: item.position,
    startDate: item.startDate,
    dueDate: item.dueDate,
    completedAt: item.completedAt,
    archivedAt: item.archivedAt,
    estimatedMinutes: item.details.kind === 'TASK' ? item.details.estimatedMinutes : null,

    // The contract carries a list because other kinds may have several; a Task
    // holds one. Taking the first is lossless for both kinds today.
    assigneeId: item.assignees[0]?.id ?? null,
    assignee: item.assignees[0] ?? null,
    createdById: item.createdById,

    subtaskCount: item.subtaskCount,
    completedSubtaskCount: item.completedSubtaskCount,

    /*
     * Renamed, not merely copied. The wire shape says `textValue`; the List's
     * value type says `text`. Both names are reasonable and neither is going to
     * change for this, so the translation lives here with everything else.
     */
    customFieldValues: item.customFieldValues.map((value): TaskCustomFieldValue => ({
      customFieldId: value.fieldId,
      text: value.textValue,
      number: value.numberValue,
      date: value.dateValue,
      checkbox: value.booleanValue,
      optionIds: value.optionIds,
      userIds: value.userIds,
    })),

    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
