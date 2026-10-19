import type { GoalProgressSource, GoalStatus } from '@coretask/contracts';

import type { UserRef } from './work-items.js';

/** A project a goal is connected to, with the completion it contributes. */
export interface GoalProjectRef {
  id: string;
  name: string;
  color: string;
  /** 0–100: completed tasks over all tasks, as the project's own progress reads. */
  completion: number;
}

/**
 * One goal, flat — the client builds the tree from `parentId`.
 *
 * `progress` is always the number to show: the stored one for a manual goal,
 * worked out on read for one that rolls up its sub-goals or projects.
 */
export interface Goal {
  id: string;
  workspaceId: string;
  parentId: string | null;
  name: string;
  description: string | null;
  status: GoalStatus;
  progressSource: GoalProgressSource;
  progress: number;
  /** A numeric goal's figures; null until it is measured by a number. */
  metric: GoalMetric | null;
  owner: UserRef | null;
  team: { id: string; name: string; color: string } | null;
  /** Free text, as Asana's time periods read: "Q4 FY26", "H1 2027". */
  timePeriod: string | null;
  dueDate: string | null;
  projects: GoalProjectRef[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateGoalPayload {
  name: string;
  description?: string | null;
  parentId?: string | null;
  ownerId?: string | null;
  teamId?: string | null;
  timePeriod?: string | null;
  dueDate?: string | null;
  status?: GoalStatus;
  progressSource?: GoalProgressSource;
  progress?: number;
  metricStart?: number | null;
  metricCurrent?: number | null;
  metricTarget?: number | null;
  metricUnit?: string | null;
}

export type UpdateGoalPayload = Partial<CreateGoalPayload>;

/** A goal's status update: a status, a note, and the progress at the time. */
export interface GoalUpdate {
  id: string;
  goalId: string;
  status: GoalStatus;
  progress: number;
  body: string;
  author: { id: string; name: string; avatarUrl: string | null } | null;
  createdAt: string;
}

export interface PostGoalUpdatePayload {
  status: GoalStatus;
  body?: string;
}

/** What a goal measured by a number counts. */
export interface GoalMetric {
  start: number;
  current: number;
  target: number;
  /** "leases", "$", "%" — shown beside the numbers. */
  unit: string | null;
}
