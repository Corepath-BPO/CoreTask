/**
 * What kind of task a task is — Asana's task types.
 *
 * A milestone is a checkpoint: no work of its own, a date that matters, a
 * diamond on the timeline. An approval is a decision somebody has to make,
 * answered with Approve, Request changes or Reject rather than ticked off.
 * Both are tasks underneath, so everything a task has — assignee, dates,
 * comments, rules — they have too.
 */

export const TaskKind = {
  TASK: 'TASK',
  MILESTONE: 'MILESTONE',
  APPROVAL: 'APPROVAL',
} as const;
export type TaskKind = (typeof TaskKind)[keyof typeof TaskKind];
export const TASK_KINDS = Object.values(TaskKind);

export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  TASK: 'Task',
  MILESTONE: 'Milestone',
  APPROVAL: 'Approval',
};

export const ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  CHANGES_REQUESTED: 'CHANGES_REQUESTED',
  REJECTED: 'REJECTED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];
export const APPROVAL_STATUSES = Object.values(ApprovalStatus);

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REJECTED: 'Rejected',
};

/** The button that gives each decision, as Asana words it. */
export const APPROVAL_ACTION_LABEL: Record<Exclude<ApprovalStatus, 'PENDING'>, string> = {
  APPROVED: 'Approve',
  CHANGES_REQUESTED: 'Request changes',
  REJECTED: 'Reject',
};

/**
 * Whether a decision closes the approval.
 *
 * Approving and rejecting both end it — somebody decided — and requesting
 * changes sends it back, open, to whoever asked.
 */
export function approvalCompletes(status: ApprovalStatus): boolean {
  return status === ApprovalStatus.APPROVED || status === ApprovalStatus.REJECTED;
}
