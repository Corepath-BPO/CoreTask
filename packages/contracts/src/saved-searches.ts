/**
 * Advanced search and saved searches — Asana's "Advanced search".
 *
 * A search is a set of filters over the tasks the reader can see. It lives in
 * the address bar, so a search is a link; saving one gives it a name and a
 * place in the sidebar. Saved searches are the person's own.
 */

export const SearchCompletion = {
  INCOMPLETE: 'INCOMPLETE',
  COMPLETED: 'COMPLETED',
  ANY: 'ANY',
} as const;
export type SearchCompletion = (typeof SearchCompletion)[keyof typeof SearchCompletion];
export const SEARCH_COMPLETIONS = Object.values(SearchCompletion);

export const SEARCH_COMPLETION_LABEL: Record<SearchCompletion, string> = {
  INCOMPLETE: 'Incomplete',
  COMPLETED: 'Completed',
  ANY: 'Any status',
};

/** Due-date windows, read against the searcher's own today. */
export const SearchDue = {
  ANY: 'ANY',
  OVERDUE: 'OVERDUE',
  TODAY: 'TODAY',
  NEXT_7_DAYS: 'NEXT_7_DAYS',
  NO_DATE: 'NO_DATE',
} as const;
export type SearchDue = (typeof SearchDue)[keyof typeof SearchDue];
export const SEARCH_DUES = Object.values(SearchDue);

export const SEARCH_DUE_LABEL: Record<SearchDue, string> = {
  ANY: 'Any due date',
  OVERDUE: 'Overdue',
  TODAY: 'Due today',
  NEXT_7_DAYS: 'Due in the next 7 days',
  NO_DATE: 'No due date',
};

export const SearchSort = {
  DUE_DATE: 'DUE_DATE',
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  TITLE: 'TITLE',
} as const;
export type SearchSort = (typeof SearchSort)[keyof typeof SearchSort];
export const SEARCH_SORTS = Object.values(SearchSort);

export const SEARCH_SORT_LABEL: Record<SearchSort, string> = {
  DUE_DATE: 'Due date',
  CREATED: 'Newest first',
  UPDATED: 'Recently changed',
  TITLE: 'Title',
};

/** Stands for the searcher in a people filter, so a saved "assigned to me" stays theirs. */
export const SEARCH_ME = 'me';
/** Stands for "nobody" in the assignee filter. */
export const SEARCH_NOBODY = 'none';

export const SEARCH_TEXT_MAX = 200;
export const SEARCH_FILTER_IDS_MAX = 20;
export const SEARCH_RESULTS_LIMIT = 100;
export const SAVED_SEARCH_NAME_MAX = 80;
export const MAX_SAVED_SEARCHES = 50;

/** What a search asks for. Every part is optional; none at all is "every task". */
export interface TaskSearchFilters {
  text?: string;
  /** User ids, `me`, or `none` for unassigned. */
  assigneeIds?: string[];
  projectIds?: string[];
  tagIds?: string[];
  completion?: SearchCompletion;
  due?: SearchDue;
  /** User ids or `me`. */
  createdByIds?: string[];
  /** User ids or `me`. */
  collaboratorIds?: string[];
  sort?: SearchSort;
}

const ID_PATTERN = /^[0-9a-f-]{36}$/i;

function ids(value: unknown, extra: readonly string[]): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const kept = value
    .filter(
      (item): item is string =>
        typeof item === 'string' && (ID_PATTERN.test(item) || extra.includes(item)),
    )
    .slice(0, SEARCH_FILTER_IDS_MAX);
  return kept.length > 0 ? [...new Set(kept)] : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined;
}

/**
 * Filters as they may be trusted: unknown keys and values dropped, lists
 * capped, empty parts left out. Used on the way in and on a stored search.
 */
export function readTaskSearchFilters(value: unknown): TaskSearchFilters {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const text =
    typeof record['text'] === 'string' ? record['text'].trim().slice(0, SEARCH_TEXT_MAX) : '';
  const filters: TaskSearchFilters = {
    ...(text ? { text } : {}),
    assigneeIds: ids(record['assigneeIds'], [SEARCH_ME, SEARCH_NOBODY]),
    projectIds: ids(record['projectIds'], []),
    tagIds: ids(record['tagIds'], []),
    completion: oneOf(record['completion'], SEARCH_COMPLETIONS),
    due: oneOf(record['due'], SEARCH_DUES),
    createdByIds: ids(record['createdByIds'], [SEARCH_ME]),
    collaboratorIds: ids(record['collaboratorIds'], [SEARCH_ME]),
    sort: oneOf(record['sort'], SEARCH_SORTS),
  };
  for (const key of Object.keys(filters) as (keyof TaskSearchFilters)[]) {
    if (filters[key] === undefined) delete filters[key];
  }
  if (filters.due === SearchDue.ANY) delete filters.due;
  return filters;
}

/** True when two searches ask the same thing, whatever order their lists are in. */
export function sameTaskSearch(a: TaskSearchFilters, b: TaskSearchFilters): boolean {
  const norm = (filters: TaskSearchFilters) => {
    const read = readTaskSearchFilters(filters);
    return JSON.stringify(
      Object.fromEntries(
        Object.entries(read)
          .map(([key, value]) => [key, Array.isArray(value) ? [...value].sort() : value])
          .sort(([x], [y]) => String(x).localeCompare(String(y))),
      ),
    );
  };
  return norm(a) === norm(b);
}
