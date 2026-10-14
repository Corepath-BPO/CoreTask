import type { TaskSearchFilters } from '@coretask/contracts';

import type { UserRef } from './work-items.js';

/** A search someone kept, with its name and filters. */
export interface SavedSearch {
  id: string;
  name: string;
  filters: TaskSearchFilters;
  createdAt: string;
  updatedAt: string;
}

export interface SaveSearchPayload {
  name: string;
  filters: TaskSearchFilters;
}

export interface UpdateSavedSearchPayload {
  name?: string;
  filters?: TaskSearchFilters;
}

/** A search, as the API runs it: the filters, and the searcher's today for due-date windows. */
export interface RunTaskSearchPayload {
  filters: TaskSearchFilters;
  /** `YYYY-MM-DD`, local to the searcher. */
  today?: string;
}

/** One task in the results: enough for a row, the panel opens the rest. */
export interface TaskSearchResult {
  id: string;
  title: string;
  completedAt: string | null;
  dueDate: string | null;
  project: { id: string; name: string; color: string } | null;
  parentTitle: string | null;
  assignee: UserRef | null;
  updatedAt: string;
}

export interface TaskSearchPage {
  items: TaskSearchResult[];
  /** Every match; `items` stops at the results limit. */
  total: number;
}
