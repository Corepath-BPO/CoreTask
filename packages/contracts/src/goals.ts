/**
 * A goal's status — Asana's two families: the in-flight reading (on track,
 * at risk, off track) and the closing verdict (achieved, partial, missed,
 * dropped). `NO_STATUS` is a goal nobody has assessed yet.
 */
export const GoalStatus = {
  NO_STATUS: 'NO_STATUS',
  ON_TRACK: 'ON_TRACK',
  AT_RISK: 'AT_RISK',
  OFF_TRACK: 'OFF_TRACK',
  ACHIEVED: 'ACHIEVED',
  PARTIAL: 'PARTIAL',
  MISSED: 'MISSED',
  DROPPED: 'DROPPED',
} as const;
export type GoalStatus = (typeof GoalStatus)[keyof typeof GoalStatus];
export const GOAL_STATUSES = Object.values(GoalStatus);

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  NO_STATUS: 'No status',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OFF_TRACK: 'Off track',
  ACHIEVED: 'Achieved',
  PARTIAL: 'Partial',
  MISSED: 'Missed',
  DROPPED: 'Dropped',
};

/** Statuses that close a goal: the period is over and a verdict is in. */
export const CLOSED_GOAL_STATUSES: readonly GoalStatus[] = [
  GoalStatus.ACHIEVED,
  GoalStatus.PARTIAL,
  GoalStatus.MISSED,
  GoalStatus.DROPPED,
];

/**
 * Where a goal's progress comes from. Asana lets a goal be updated by hand or
 * rolled up from its sub-goals or its connected projects; a computed source
 * keeps the number honest, a manual one covers what no project measures.
 */
export const GoalProgressSource = {
  MANUAL: 'MANUAL',
  SUB_GOALS: 'SUB_GOALS',
  PROJECTS: 'PROJECTS',
  /** A number moving from a start towards a target — "40 leases signed". */
  METRIC: 'METRIC',
} as const;
export type GoalProgressSource = (typeof GoalProgressSource)[keyof typeof GoalProgressSource];
export const GOAL_PROGRESS_SOURCES = Object.values(GoalProgressSource);

export const GOAL_NAME_MAX_LENGTH = 200;
export const GOAL_TIME_PERIOD_MAX_LENGTH = 32;

export const GOAL_METRIC_UNIT_MAX = 16;

/**
 * A numeric goal's progress, 0–100: how far the current value has come from
 * the start towards the target. It works counting down too — a target below
 * the start. With no distance to cover, reaching the target is all of it.
 */
export function metricProgress(start: number, current: number, target: number): number {
  if (target === start) return current === target ? 100 : 0;
  const share = (current - start) / (target - start);
  return Math.min(100, Math.max(0, Math.round(share * 100)));
}
