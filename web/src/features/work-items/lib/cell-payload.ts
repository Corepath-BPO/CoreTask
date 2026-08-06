import type { UpdateWorkItemPayload } from '@coretask/types';

/**
 * What a grid cell emits, translated into what the work-item API takes.
 *
 * The cells were written against the task endpoint and speak its language:
 * `status`, `priority`, a single `assigneeId`. The shared endpoint speaks the
 * work-item one: `statusId`, `priorityId`, a list of assignees. Same values,
 * different names, and the translation belongs in one place rather than in
 * every cell.
 *
 * This is what routes a ticket's edits somewhere they can land at all. The List
 * used to send every inline change to `PATCH /tasks/:id`, which for a ticket id
 * is a 404 — so editing a ticket in the grid quietly did nothing.
 */
export function toWorkItemUpdate(payload: Record<string, unknown>): UpdateWorkItemPayload {
  const update: UpdateWorkItemPayload = {};

  if ('title' in payload) update.title = payload['title'] as string;
  if ('description' in payload) update.description = payload['description'] as string | null;
  if ('status' in payload) update.statusId = payload['status'] as string;
  if ('priority' in payload) update.priorityId = payload['priority'] as string;
  if ('startDate' in payload) update.startDate = payload['startDate'] as string | null;
  if ('dueDate' in payload) update.dueDate = payload['dueDate'] as string | null;

  if ('assigneeId' in payload) {
    // An empty list clears it. `[null]` would be a list containing nothing,
    // which is a different and invalid thing to send.
    const assigneeId = payload['assigneeId'] as string | null;
    update.assigneeIds = assigneeId ? [assigneeId] : [];
  }

  return update;
}
