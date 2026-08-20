import type {
  CreateProjectViewPayload,
  CustomField,
  FieldCatalog,
  ProjectFieldMetadata,
  ProjectView,
  Task,
  UpdateCustomFieldPayload,
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

  subtasks: (workspaceId: string, projectId: string, taskId: string): Promise<Task[]> =>
    apiClient.get<Task[]>(`${base(workspaceId, projectId)}/tasks/${taskId}/subtasks`),

  /**
   * Everything the add-field picker offers, searched server-side.
   *
   * `visible` is sent so the API can mark entries already in the view rather
   * than the client filtering them out — the difference between "already
   * added" and "no such field" matters to whoever is looking.
   */
  fieldCatalog: (
    workspaceId: string,
    projectId: string,
    params: { search?: string; visible?: string[]; includeArchived?: boolean } = {},
  ): Promise<FieldCatalog> =>
    apiClient.get<FieldCatalog>(`${base(workspaceId, projectId)}/field-catalog`, {
      params: {
        ...(params.search ? { search: params.search } : {}),
        // Joined rather than repeated: axios serialises arrays as `visible[]=`,
        // which the API's strict validation refuses as an unknown property.
        ...(params.visible?.length ? { visible: params.visible.join(',') } : {}),
        ...(params.includeArchived ? { includeArchived: 'true' } : {}),
      },
    }),

  fieldMetadata: (workspaceId: string, projectId: string): Promise<ProjectFieldMetadata> =>
    apiClient.get<ProjectFieldMetadata>(`${base(workspaceId, projectId)}/field-metadata`),
};

export const customFieldsApi = {
  list: (workspaceId: string, projectId: string): Promise<CustomField[]> =>
    apiClient.get<CustomField[]>(`${base(workspaceId, projectId)}/custom-fields`),

  /** Reuses an existing workspace field here, rather than making a second one. */
  attach: (workspaceId: string, projectId: string, fieldId: string): Promise<CustomField> =>
    apiClient.post<CustomField>(
      `${base(workspaceId, projectId)}/custom-fields/${fieldId}/attach`,
      {},
    ),

  create: (
    workspaceId: string,
    projectId: string,
    payload: {
      name: string;
      type: string;
      description?: string;
      isRequired?: boolean;
      /** Type-specific configuration; validated against the type server-side. */
      settings?: Record<string, unknown>;
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

  /** The type cannot change — everything else about a field can. */
  update: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    payload: UpdateCustomFieldPayload,
  ): Promise<CustomField> =>
    apiClient.patch<CustomField>(
      `${base(workspaceId, projectId)}/custom-fields/${fieldId}`,
      payload,
    ),

  addOption: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    payload: { label: string; colorToken?: string },
  ): Promise<CustomField> =>
    apiClient.post<CustomField>(
      `${base(workspaceId, projectId)}/custom-fields/${fieldId}/options`,
      payload,
    ),

  updateOption: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    optionId: string,
    payload: { label?: string; colorToken?: string; position?: number },
  ): Promise<CustomField> =>
    apiClient.patch<CustomField>(
      `${base(workspaceId, projectId)}/custom-fields/${fieldId}/options/${optionId}`,
      payload,
    ),

  removeOption: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    optionId: string,
  ): Promise<{ deleted: boolean; archived: boolean }> =>
    apiClient.delete<{ deleted: boolean; archived: boolean }>(
      `${base(workspaceId, projectId)}/custom-fields/${fieldId}/options/${optionId}`,
    ),

  setValue: (
    workspaceId: string,
    taskId: string,
    fieldId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> =>
    apiClient.put(`/workspaces/${workspaceId}/tasks/${taskId}/custom-fields/${fieldId}`, payload),
};
