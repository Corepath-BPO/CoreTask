/**
 * What kind of thing a project holds.
 *
 * A project owns work items; List and Board are two ways of drawing the same
 * set. The type says which underlying record a work item is backed by, and it
 * is stable — a task never becomes a ticket, because the two carry different
 * identity (a ticket has a workspace-scoped key somebody may have quoted in an
 * email) and different history.
 *
 * `MILESTONE` and `APPROVAL` are declared here and are **not** creatable yet:
 * neither has a model behind it. They are listed so the picker can show them as
 * coming rather than pretend they are missing, and so adding them later does not
 * change this union. See `CREATABLE_WORK_ITEM_TYPES` for what may actually be
 * created — never assume every member of this union can be.
 */
export const WorkItemType = {
  TASK: 'TASK',
  TICKET: 'TICKET',
  MILESTONE: 'MILESTONE',
  APPROVAL: 'APPROVAL',
} as const;
export type WorkItemType = (typeof WorkItemType)[keyof typeof WorkItemType];

export const WORK_ITEM_TYPES = Object.values(WorkItemType);

/**
 * The types a work item can actually be created as today.
 *
 * The single source of truth for "is this real", used by the API to reject a
 * type it cannot store and by the picker to decide what to disable. Two lists
 * that could disagree is how a menu ends up offering something the server
 * refuses.
 */
export const CREATABLE_WORK_ITEM_TYPES: readonly WorkItemType[] = [
  WorkItemType.TASK,
  WorkItemType.TICKET,
];

export function isCreatableWorkItemType(type: WorkItemType): boolean {
  return CREATABLE_WORK_ITEM_TYPES.includes(type);
}

export const WORK_ITEM_TYPE_LABEL: Record<WorkItemType, string> = {
  TASK: 'Task',
  TICKET: 'Ticket',
  MILESTONE: 'Milestone',
  APPROVAL: 'Approval',
};

/** Used on the split button: "+ Add ticket". */
export const WORK_ITEM_TYPE_ACTION_LABEL: Record<WorkItemType, string> = {
  TASK: 'Add task',
  TICKET: 'Add ticket',
  MILESTONE: 'Add milestone',
  APPROVAL: 'Add approval',
};

export const WORK_ITEM_TYPE_DESCRIPTION: Record<WorkItemType, string> = {
  TASK: 'A unit of work with subtasks, custom fields and a due date',
  TICKET: 'A tracked request with a shareable key, type and severity',
  MILESTONE: 'A checkpoint on the project timeline',
  APPROVAL: 'A decision somebody has to sign off',
};

/**
 * What rides on a `work-item:*` socket event.
 *
 * `correlationId` is the client's own mutation id, echoed back. A client that
 * recognises its own id skips re-applying the change over the optimistic row it
 * already drew — which is what stops a freshly created item appearing twice.
 *
 * `changedFields` lets a listener decide whether it cares at all; a board that
 * shows no due-date badge can ignore a due-date change.
 */
export interface WorkItemEventPayload<TItem = unknown> {
  workspaceId: string;
  projectId: string;
  workItemId: string;
  workItemType: WorkItemType;
  changedFields?: string[];
  /** Absent on delete, where there is nothing left to send. */
  workItem?: TItem;
  /** Where it came from and where it went — move events only. */
  fromSectionId?: string | null;
  toSectionId?: string | null;
  actorId: string | null;
  correlationId?: string;
  occurredAt: string;
}
