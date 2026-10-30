import { ApiRoutes } from '@coretask/contracts';
import type {
  AdminDeactivateResult,
  AdminHandOverPayload,
  AdminInvitationLink,
  AdminMember,
  AdminOverview,
  AdminTeam,
  RemoveMemberResult,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const adminApi = {
  overview: (workspaceId: string): Promise<AdminOverview> =>
    apiClient.get<AdminOverview>(ApiRoutes.admin.overview(workspaceId)),

  members: (workspaceId: string): Promise<AdminMember[]> =>
    apiClient.get<AdminMember[]>(ApiRoutes.admin.members(workspaceId)),

  deactivate: (
    workspaceId: string,
    memberId: string,
    payload: AdminHandOverPayload,
  ): Promise<AdminDeactivateResult> =>
    apiClient.post<AdminDeactivateResult>(
      ApiRoutes.admin.deactivate(workspaceId, memberId),
      payload,
    ),

  reactivate: (workspaceId: string, memberId: string): Promise<AdminMember> =>
    apiClient.post<AdminMember>(ApiRoutes.admin.reactivate(workspaceId, memberId)),

  remove: (
    workspaceId: string,
    memberId: string,
    payload: AdminHandOverPayload,
  ): Promise<RemoveMemberResult> =>
    apiClient.post<RemoveMemberResult>(ApiRoutes.admin.remove(workspaceId, memberId), payload),

  teams: (workspaceId: string): Promise<AdminTeam[]> =>
    apiClient.get<AdminTeam[]>(ApiRoutes.admin.teams(workspaceId)),

  invitationLink: (workspaceId: string, invitationId: string): Promise<AdminInvitationLink> =>
    apiClient.post<AdminInvitationLink>(ApiRoutes.admin.invitationLink(workspaceId, invitationId)),
};
