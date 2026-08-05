import type {
  CreateWorkItemPayload,
  MoveWorkItemPayload,
  ProjectWorkItem,
  ProjectWorkItemPage,
  ProjectWorkItemQuery,
  UpdateWorkItemPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

const base = (workspaceId: string, projectId: string) =>
  `/workspaces/${workspaceId}/projects/${projectId}/work-items`;

/**
 * `types` goes over the wire as one comma-separated parameter.
 *
 * Axios serialises an array as `types[]=…`, which strict validation rejects as
 * an unknown property — the trap the field catalog hit, kept from repeating by
 * building the query string here rather than in each caller.
 */
function toSearchParams(query: ProjectWorkItemQuery): Record<string, string> {
  const params: Record<string, string> = {};

  if (query.types?.length) params['types'] = query.types.join(',');
  if (query.sectionId !== undefined && query.sectionId !== null) {
    params['sectionId'] = query.sectionId;
  }
  if (query.search) params['search'] = query.search;
  if (query.includeArchived) params['includeArchived'] = 'true';
  if (query.limit !== undefined) params['limit'] = String(query.limit);
  if (query.cursor) params['cursor'] = query.cursor;

  return params;
}

/**
 * One client for a project's work items, used by List and Board alike.
 *
 * There is deliberately no `createFromList`/`createFromBoard` pair here either:
 * the two views calling different functions is how they came to behave
 * differently in the first place.
 */
export const workItemsApi = {
  list: (
    workspaceId: string,
    projectId: string,
    query: ProjectWorkItemQuery = {},
  ): Promise<ProjectWorkItemPage> =>
    apiClient.get<ProjectWorkItemPage>(base(workspaceId, projectId), {
      params: toSearchParams(query),
    }),

  get: (workspaceId: string, projectId: string, workItemId: string): Promise<ProjectWorkItem> =>
    apiClient.get<ProjectWorkItem>(`${base(workspaceId, projectId)}/${workItemId}`),

  create: (
    workspaceId: string,
    projectId: string,
    payload: CreateWorkItemPayload,
  ): Promise<ProjectWorkItem> =>
    apiClient.post<ProjectWorkItem>(base(workspaceId, projectId), payload),

  update: (
    workspaceId: string,
    projectId: string,
    workItemId: string,
    payload: UpdateWorkItemPayload,
  ): Promise<ProjectWorkItem> =>
    apiClient.patch<ProjectWorkItem>(`${base(workspaceId, projectId)}/${workItemId}`, payload),

  move: (
    workspaceId: string,
    projectId: string,
    workItemId: string,
    payload: MoveWorkItemPayload,
  ): Promise<ProjectWorkItem> =>
    apiClient.patch<ProjectWorkItem>(`${base(workspaceId, projectId)}/${workItemId}/move`, payload),
};
