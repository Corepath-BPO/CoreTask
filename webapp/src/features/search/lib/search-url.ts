import { readTaskSearchFilters, type TaskSearchFilters } from '@coretask/contracts';

/**
 * A search as it sits in the address bar, so a search is a link: short keys,
 * lists comma-separated. `saved` names the saved search being looked at and
 * `task` the task open over the results.
 */
export interface SearchParams {
  q?: string;
  assignee?: string;
  project?: string;
  tag?: string;
  status?: string;
  due?: string;
  createdBy?: string;
  collaborator?: string;
  sort?: string;
  saved?: string;
  task?: string;
}

const KEYS = [
  'q',
  'assignee',
  'project',
  'tag',
  'status',
  'due',
  'createdBy',
  'collaborator',
  'sort',
  'saved',
  'task',
] as const;

/** For the route: strings only, everything else dropped. */
export function validateSearchParams(search: Record<string, unknown>): SearchParams {
  const params: SearchParams = {};
  for (const key of KEYS) {
    const value = search[key];
    if (typeof value === 'string' && value.trim() !== '') params[key] = value;
  }
  return params;
}

const list = (value: string | undefined) => (value ? value.split(',').filter(Boolean) : undefined);
const join = (value: string[] | undefined) =>
  value && value.length > 0 ? value.join(',') : undefined;

export function filtersFromParams(params: SearchParams): TaskSearchFilters {
  return readTaskSearchFilters({
    text: params.q,
    assigneeIds: list(params.assignee),
    projectIds: list(params.project),
    tagIds: list(params.tag),
    completion: params.status,
    due: params.due,
    createdByIds: list(params.createdBy),
    collaboratorIds: list(params.collaborator),
    sort: params.sort,
  });
}

/** The filters' half of the params; `saved` and `task` are the caller's to add. */
export function paramsFromFilters(filters: TaskSearchFilters): SearchParams {
  const read = readTaskSearchFilters(filters);
  const params: SearchParams = {
    q: read.text,
    assignee: join(read.assigneeIds),
    project: join(read.projectIds),
    tag: join(read.tagIds),
    status: read.completion,
    due: read.due,
    createdBy: join(read.createdByIds),
    collaborator: join(read.collaboratorIds),
    sort: read.sort,
  };
  for (const key of Object.keys(params) as (keyof SearchParams)[]) {
    if (params[key] === undefined) delete params[key];
  }
  return params;
}
