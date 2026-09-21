import { ApiRoutes } from '@coretask/contracts';
import type {
  CreateProjectViewPayload,
  CustomField,
  FieldCatalog,
  ProjectFieldMetadata,
  ProjectView,
  RemoveFieldMode,
  RemoveFieldResult,
  Task,
  UpdateCustomFieldPayload,
  UpdateProjectViewPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

const base = (workspaceId: string, projectId: string) =>
  `/workspaces/${workspaceId}/projects/${projectId}`;

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
    apiClient.get<CustomField[]>(ApiRoutes.customFields.forProject(workspaceId, projectId)),

  /** Reuses an existing workspace field here, rather than making a second one. */
  attach: (workspaceId: string, projectId: string, fieldId: string): Promise<CustomField> =>
    apiClient.post<CustomField>(ApiRoutes.customFields.attach(workspaceId, projectId, fieldId), {}),

  create: (
    workspaceId: string,
    projectId: string,
    payload: {
      name: string;
      type: string;
      description?: string;
      isRequired?: boolean;
      notifyOnChange?: boolean;
      /** Type-specific configuration; validated against the type server-side. */
      settings?: Record<string, unknown>;
      options?: { label: string; colorToken?: string }[];
    },
  ): Promise<CustomField> =>
    apiClient.post<CustomField>(ApiRoutes.customFields.forProject(workspaceId, projectId), payload),

  /**
   * Takes a field off this project.
   *
   * `mode` says what was meant: `detach` keeps the definition in the library,
   * `delete` removes it from every project (archiving when tasks hold values).
   * Without one the API chooses from state, as it always has.
   */
  remove: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    mode?: RemoveFieldMode,
  ): Promise<RemoveFieldResult> =>
    apiClient.delete<RemoveFieldResult>(
      ApiRoutes.customFields.forProjectField(workspaceId, projectId, fieldId),
      mode ? { params: { mode } } : undefined,
    ),

  /** The type cannot change — everything else about a field can. */
  update: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    payload: UpdateCustomFieldPayload,
  ): Promise<CustomField> =>
    apiClient.patch<CustomField>(
      ApiRoutes.customFields.forProjectField(workspaceId, projectId, fieldId),
      payload,
    ),

  /**
   * The definition alone, with no project in the URL — the one route that can
   * reach a field no project holds any more, which is how "Restore" works.
   */
  restore: (workspaceId: string, fieldId: string): Promise<CustomField> =>
    apiClient.patch<CustomField>(ApiRoutes.customFields.libraryField(workspaceId, fieldId), {
      isArchived: false,
    }),

  addOption: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    payload: { label: string; colorToken?: string },
  ): Promise<CustomField> =>
    apiClient.post<CustomField>(
      ApiRoutes.customFields.options(workspaceId, projectId, fieldId),
      payload,
    ),

  updateOption: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    optionId: string,
    payload: { label?: string; colorToken?: string; position?: number; isArchived?: boolean },
  ): Promise<CustomField> =>
    apiClient.patch<CustomField>(
      ApiRoutes.customFields.option(workspaceId, projectId, fieldId, optionId),
      payload,
    ),

  removeOption: (
    workspaceId: string,
    projectId: string,
    fieldId: string,
    optionId: string,
  ): Promise<{ deleted: boolean; archived: boolean }> =>
    apiClient.delete<{ deleted: boolean; archived: boolean }>(
      ApiRoutes.customFields.option(workspaceId, projectId, fieldId, optionId),
    ),

  setValue: (
    workspaceId: string,
    taskId: string,
    fieldId: string,
    payload: Record<string, unknown>,
  ): Promise<unknown> =>
    apiClient.put(ApiRoutes.customFields.taskValue(workspaceId, taskId, fieldId), payload),
};
