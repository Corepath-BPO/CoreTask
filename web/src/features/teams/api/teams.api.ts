import { ApiRoutes } from '@coretask/contracts';
import type {
  AddTeamMemberPayload,
  CreateTeamPayload,
  Team,
  TeamDetail,
  UpdateTeamPayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const teamsApi = {
  list: (workspaceId: string): Promise<Team[]> =>
    apiClient.get<Team[]>(ApiRoutes.teams.list(workspaceId)),

  detail: (workspaceId: string, teamId: string): Promise<TeamDetail> =>
    apiClient.get<TeamDetail>(ApiRoutes.teams.detail(workspaceId, teamId)),

  create: (workspaceId: string, payload: CreateTeamPayload): Promise<Team> =>
    apiClient.post<Team>(ApiRoutes.teams.create(workspaceId), payload),

  update: (workspaceId: string, teamId: string, payload: UpdateTeamPayload): Promise<Team> =>
    apiClient.patch<Team>(ApiRoutes.teams.update(workspaceId, teamId), payload),

  remove: (workspaceId: string, teamId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.teams.remove(workspaceId, teamId)),

  addMember: (
    workspaceId: string,
    teamId: string,
    payload: AddTeamMemberPayload,
  ): Promise<TeamDetail> =>
    apiClient.post<TeamDetail>(ApiRoutes.teams.addMember(workspaceId, teamId), payload),

  removeMember: (workspaceId: string, teamId: string, userId: string): Promise<TeamDetail> =>
    apiClient.delete<TeamDetail>(ApiRoutes.teams.removeMember(workspaceId, teamId, userId)),
};
