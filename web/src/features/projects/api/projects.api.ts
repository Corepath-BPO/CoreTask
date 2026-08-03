import { ApiRoutes } from '@coretask/contracts';
import type {
  CreateProjectPayload,
  CreateSectionPayload,
  MoveSectionPayload,
  PaginationMeta,
  ProjectDetail,
  ProjectSummary,
  Section,
  UpdateProjectPayload,
  UpdateSectionPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export interface ProjectListParams {
  page?: number;
  limit?: number;
  status?: string;
  includeArchived?: boolean;
  search?: string;
}

export const projectsApi = {
  list: (
    workspaceId: string,
    params: ProjectListParams = {},
  ): Promise<{ items: ProjectSummary[]; meta: PaginationMeta }> =>
    apiClient.getPaginated<ProjectSummary>(ApiRoutes.projects.list(workspaceId), { params }),

  get: (workspaceId: string, projectId: string): Promise<ProjectDetail> =>
    apiClient.get<ProjectDetail>(ApiRoutes.projects.detail(workspaceId, projectId)),

  create: (workspaceId: string, payload: CreateProjectPayload): Promise<ProjectDetail> =>
    apiClient.post<ProjectDetail>(ApiRoutes.projects.create(workspaceId), payload),

  update: (
    workspaceId: string,
    projectId: string,
    payload: UpdateProjectPayload,
  ): Promise<ProjectSummary> =>
    apiClient.patch<ProjectSummary>(ApiRoutes.projects.update(workspaceId, projectId), payload),

  archive: (workspaceId: string, projectId: string): Promise<ProjectSummary> =>
    apiClient.delete<ProjectSummary>(ApiRoutes.projects.archive(workspaceId, projectId)),

  restore: (workspaceId: string, projectId: string): Promise<ProjectSummary> =>
    apiClient.post<ProjectSummary>(ApiRoutes.projects.restore(workspaceId, projectId)),
};

export const sectionsApi = {
  list: (workspaceId: string, projectId: string): Promise<Section[]> =>
    apiClient.get<Section[]>(ApiRoutes.sections.list(workspaceId, projectId)),

  create: (
    workspaceId: string,
    projectId: string,
    payload: CreateSectionPayload,
  ): Promise<Section> =>
    apiClient.post<Section>(ApiRoutes.sections.create(workspaceId, projectId), payload),

  update: (
    workspaceId: string,
    projectId: string,
    sectionId: string,
    payload: UpdateSectionPayload,
  ): Promise<Section> =>
    apiClient.patch<Section>(ApiRoutes.sections.update(workspaceId, projectId, sectionId), payload),

  /** Returns the full ordered list — a move can renumber every sibling. */
  move: (
    workspaceId: string,
    projectId: string,
    sectionId: string,
    payload: MoveSectionPayload,
  ): Promise<Section[]> =>
    apiClient.patch<Section[]>(ApiRoutes.sections.move(workspaceId, projectId, sectionId), payload),

  remove: (
    workspaceId: string,
    projectId: string,
    sectionId: string,
  ): Promise<{ deleted: boolean; reassignedTaskCount: number }> =>
    apiClient.delete<{ deleted: boolean; reassignedTaskCount: number }>(
      ApiRoutes.sections.remove(workspaceId, projectId, sectionId),
    ),
};
