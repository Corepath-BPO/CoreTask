import type { ReportChartKind, ReportCompletion, ReportGroupBy } from '@coretask/contracts';

import type { UpdateAuthor } from './project-updates.js';

/** The question a chart asks. */
export interface ReportQuery {
  groupBy: ReportGroupBy;
  completion: ReportCompletion;
  /** Narrowed to these projects; empty for every project the reader can see. */
  projectIds: string[];
  overdueOnly: boolean;
}

/** One chart on a dashboard. */
export interface ReportChart extends ReportQuery {
  id: string;
  title: string;
  kind: ReportChartKind;
}

export interface ReportDashboard {
  id: string;
  name: string;
  owner: UpdateAuthor | null;
  charts: ReportChart[];
  createdAt: string;
  updatedAt: string;
}

export interface ReportDashboardDraft {
  name: string;
  charts?: ReportChart[];
}

/** The answer to a chart's question, for the reader. */
export interface ReportResult {
  total: number;
  groups: {
    key: string;
    label: string;
    count: number;
    /** A semantic colour token, where the grouping has one (statuses, priorities, projects' hex). */
    color: string | null;
  }[];
}
