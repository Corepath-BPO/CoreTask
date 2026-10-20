import { ApiRoutes } from '@coretask/contracts';
import type {
  AddProjectMemberPayload,
  CreateProjectInvitationPayload,
  CreateProjectPayload,
  CreateSectionPayload,
  MoveSectionPayload,
  PaginationMeta,
  ProjectDetail,
  ProjectMember,
  ProjectNotificationSettings,
  ProjectSummary,
  Section,
  UpdateProjectMemberRolePayload,
  UpdateProjectPayload,
  UpdateSectionPayload,
  WorkspaceInvitation,
  UpdateProjectNotificationSettingsPayload,
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

/** A project's roster — the list a private project is private to. */
export const projectMembersApi = {
  list: (workspaceId: string, projectId: string): Promise<ProjectMember[]> =>
    apiClient.get<ProjectMember[]>(ApiRoutes.projectMembers.list(workspaceId, projectId)),

  add: (
    workspaceId: string,
    projectId: string,
    payload: AddProjectMemberPayload,
  ): Promise<ProjectMember> =>
    apiClient.post<ProjectMember>(ApiRoutes.projectMembers.add(workspaceId, projectId), payload),

  updateRole: (
    workspaceId: string,
    projectId: string,
    userId: string,
    payload: UpdateProjectMemberRolePayload,
  ): Promise<ProjectMember> =>
    apiClient.patch<ProjectMember>(
      ApiRoutes.projectMembers.updateRole(workspaceId, projectId, userId),
      payload,
    ),

  remove: (workspaceId: string, projectId: string, userId: string): Promise<{ removed: boolean }> =>
    apiClient.delete<{ removed: boolean }>(
      ApiRoutes.projectMembers.remove(workspaceId, projectId, userId),
    ),

  join: (workspaceId: string, projectId: string): Promise<ProjectMember> =>
    apiClient.post<ProjectMember>(ApiRoutes.projectMembers.join(workspaceId, projectId)),

  leave: (workspaceId: string, projectId: string): Promise<{ left: boolean }> =>
    apiClient.post<{ left: boolean }>(ApiRoutes.projectMembers.leave(workspaceId, projectId)),

  /** What the project tells the caller about. */
  notificationSettings: (
    workspaceId: string,
    projectId: string,
  ): Promise<ProjectNotificationSettings> =>
    apiClient.get<ProjectNotificationSettings>(
      ApiRoutes.projectMembers.notificationSettings(workspaceId, projectId),
    ),

  setNotificationSettings: (
    workspaceId: string,
    projectId: string,
    payload: UpdateProjectNotificationSettingsPayload,
  ): Promise<ProjectNotificationSettings> =>
    apiClient.put<ProjectNotificationSettings>(
      ApiRoutes.projectMembers.notificationSettings(workspaceId, projectId),
      payload,
    ),

  /** Invitations still waiting that would land someone in this project. */
  invitations: (workspaceId: string, projectId: string): Promise<WorkspaceInvitation[]> =>
    apiClient.get<WorkspaceInvitation[]>(
      ApiRoutes.projectMembers.invitations(workspaceId, projectId),
    ),

  /** Workspace admins only: someone outside the workspace, straight into this project. */
  invite: (
    workspaceId: string,
    projectId: string,
    payload: CreateProjectInvitationPayload,
  ): Promise<WorkspaceInvitation> =>
    apiClient.post<WorkspaceInvitation>(
      ApiRoutes.projectMembers.invitations(workspaceId, projectId),
      payload,
    ),
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
