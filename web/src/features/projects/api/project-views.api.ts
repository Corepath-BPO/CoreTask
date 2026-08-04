import type {
  CreateProjectViewPayload,
  CustomField,
  ProjectFieldMetadata,
  ProjectView,
  Task,
  UpdateProjectViewPayload,
  ViewFilterCondition,
  ViewSort,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

const base = (workspaceId: string, projectId: string) =>
  `/workspaces/${workspaceId}/projects/${projectId}`;

export interface ViewTaskQuery {
  page?: number;
  limit?: number;
  search?: string;
  filters?: ViewFilterCondition[];
  sorts?: ViewSort[];
}

export const projectViewsApi = {
  list: (workspaceId: string, projectId: string): Promise<ProjectView[]> =>
    apiClient.get<ProjectView[]>(`${base(workspaceId, projectId)}/views`),

  create: (
    workspaceId: string,
    projectId: string,
    payload: CreateProjectViewPayload,
  ): Promise<ProjectView> =>
    apiClient.post<ProjectView>(`${base(workspaceId, projectId)}/views`, payload),

  update: (
    workspaceId: string,
    projectId: string,
    viewId: string,
    payload: UpdateProjectViewPayload,
  ): Promise<ProjectView> =>
    apiClient.patch<ProjectView>(`${base(workspaceId, projectId)}/views/${viewId}`, payload),

  remove: (workspaceId: string, projectId: string, viewId: string): Promise<{ deleted: boolean }> =>
    apiClient.delete<{ deleted: boolean }>(`${base(workspaceId, projectId)}/views/${viewId}`),

  /**
   * The tasks behind a view.
   *
   * A POST because filters are a nested structure — encoding one into a query
   * string means inventing a serialisation both sides have to agree on. Paging
   * and search stay in the query string, where they are readable.
   */
  queryTasks: (
    workspaceId: string,
    projectId: string,
    query: ViewTaskQuery,
  ): Promise<{ items: Task[]; meta: { total: number; page: number; totalPages: number } }> =>
    apiClient.postPaginated<Task>(
      `${base(workspaceId, projectId)}/tasks/query`,
      { filters: query.filters ?? [], sorts: query.sorts ?? [] },
      {
        params: {
          ...(query.page ? { page: query.page } : {}),
          ...(query.limit ? { limit: query.limit } : {}),
          ...(query.search ? { search: query.search } : {}),
        },
      },
    ),

  fieldMetadata: (workspaceId: string, projectId: string): Promise<ProjectFieldMetadata> =>
    apiClient.get<ProjectFieldMetadata>(`${base(workspaceId, projectId)}/field-metadata`),
};

export const customFieldsApi = {
  list: (workspaceId: string, projectId: string): Promise<CustomField[]> =>
    apiClient.get<CustomField[]>(`${base(workspaceId, projectId)}/custom-fields`),

  create: (
    workspaceId: string,
    projectId: string,
    payload: {
      name: string;
      type: string;
      description?: string;
      isRequired?: boolean;
      options?: { label: string; colorToken?: string }[];
    },
  ): Promise<CustomField> =>
    apiClient.post<CustomField>(`${base(workspaceId, projectId)}/custom-fields`, payload),

  remove: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
  ): Promise<{ deleted: boolean; archived: boolean }> =>
    apiClient.delete<{ deleted: boolean; archived: boolean }>(
      `${base(workspaceId, projectId)}/custom-fields/${fieldId}`,
    ),

  setValue: (
    workspaceId: string,
    taskId: string,
    fieldId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> =>
    apiClient.put(`/workspaces/${workspaceId}/tasks/${taskId}/custom-fields/${fieldId}`, payload),
};
