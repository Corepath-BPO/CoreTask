import { ApprovalStatus, TaskKind } from '@coretask/contracts';
import { BadgeCheck, CircleCheck, Diamond, type LucideIcon } from 'lucide-react';

/**
 * How each kind of task draws its completion mark: Asana's circle for a task,
 * a diamond for a milestone, a seal for an approval.
 */
export const TASK_KIND_ICON: Record<TaskKind, LucideIcon> = {
  TASK: CircleCheck,
  MILESTONE: Diamond,
  APPROVAL: BadgeCheck,
};

/** The colour an approval's mark wears for its decision. */
export const APPROVAL_TONE: Record<ApprovalStatus, string> = {
  PENDING: 'text-muted-foreground',
  APPROVED: 'text-success',
  CHANGES_REQUESTED: 'text-warning-strong',
  REJECTED: 'text-destructive',
};

/** A task's kind, for rows from before kinds existed too. */
export function kindOf(task: { kind?: TaskKind | null }): TaskKind {
  return task.kind ?? TaskKind.TASK;
}

/** What the pane's completion button says, by kind. */
export function completeLabel(kind: TaskKind, completed: boolean): string {
  if (kind === TaskKind.MILESTONE)
    return completed ? 'Milestone reached' : 'Mark milestone complete';
  return completed ? 'Completed' : 'Mark complete';
}

export { ApprovalStatus, TaskKind };
