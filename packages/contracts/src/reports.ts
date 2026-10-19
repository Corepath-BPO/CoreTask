/**
 * Report dashboards — Asana's Reporting.
 *
 * A dashboard is a named set of charts, shared with the workspace like a
 * portfolio. A chart is only a question — which tasks, grouped how, drawn how
 * — and the answer is worked out by the server each time it is drawn, over the
 * tasks the reader can see, so two people can share a dashboard and each see
 * the truth for themselves.
 */

/** What a chart's bars, slices or points stand for. */
export const ReportGroupBy = {
  /** One number: how many tasks match. */
  NONE: 'NONE',
  STATUS: 'STATUS',
  PRIORITY: 'PRIORITY',
  ASSIGNEE: 'ASSIGNEE',
  PROJECT: 'PROJECT',
  /** The next twelve weeks, by due date. */
  DUE_WEEK: 'DUE_WEEK',
  /** The last twelve weeks, by when tasks were completed. */
  COMPLETED_WEEK: 'COMPLETED_WEEK',
} as const;
export type ReportGroupBy = (typeof ReportGroupBy)[keyof typeof ReportGroupBy];
export const REPORT_GROUP_BYS = Object.values(ReportGroupBy);

export const REPORT_GROUP_BY_LABEL: Record<ReportGroupBy, string> = {
  NONE: 'Total only',
  STATUS: 'Status',
  PRIORITY: 'Priority',
  ASSIGNEE: 'Assignee',
  PROJECT: 'Project',
  DUE_WEEK: 'Due date (by week)',
  COMPLETED_WEEK: 'Completion date (by week)',
};

export const ReportChartKind = {
  NUMBER: 'NUMBER',
  BAR: 'BAR',
  DONUT: 'DONUT',
  COLUMN: 'COLUMN',
} as const;
export type ReportChartKind = (typeof ReportChartKind)[keyof typeof ReportChartKind];
export const REPORT_CHART_KINDS = Object.values(ReportChartKind);

export const REPORT_CHART_KIND_LABEL: Record<ReportChartKind, string> = {
  NUMBER: 'Number',
  BAR: 'Bar chart',
  DONUT: 'Donut chart',
  COLUMN: 'Column chart',
};

/** Which tasks by completion. */
export const ReportCompletion = {
  ALL: 'ALL',
  OPEN: 'OPEN',
  DONE: 'DONE',
} as const;
export type ReportCompletion = (typeof ReportCompletion)[keyof typeof ReportCompletion];
export const REPORT_COMPLETIONS = Object.values(ReportCompletion);

export const REPORT_COMPLETION_LABEL: Record<ReportCompletion, string> = {
  ALL: 'All tasks',
  OPEN: 'Incomplete tasks',
  DONE: 'Completed tasks',
};

export const REPORT_DASHBOARD_NAME_MAX = 120;
export const REPORT_CHART_TITLE_MAX = 120;
export const MAX_REPORT_CHARTS = 12;
export const MAX_REPORT_DASHBOARDS = 50;
/** How many projects one chart may narrow to. */
export const MAX_REPORT_CHART_PROJECTS = 50;
/** The weeks a by-week grouping spans. */
export const REPORT_WEEKS = 12;

/** The grouping a chart kind can draw: a number has no groups; the rest need some. */
export function chartKindFits(kind: ReportChartKind, groupBy: ReportGroupBy): boolean {
  return kind === ReportChartKind.NUMBER
    ? groupBy === ReportGroupBy.NONE
    : groupBy !== ReportGroupBy.NONE;
}
