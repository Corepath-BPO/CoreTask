import type { ViewSettings } from '@coretask/types';

/** What a view looks like before anyone has touched it — the API's own defaults. */
export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  columns: [],
  filters: { combinator: 'AND', conditions: [] },
  sorts: [],
  groupBy: null,
  density: 'COMFORTABLE',
  showCompleted: true,
};
