import { ApiRoutes } from '@coretask/contracts';
import type { RemoveMemberResult, UpdateMemberRolePayload, WorkspaceMember } from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const membersApi = {
  list: (workspaceId: string): Promise<WorkspaceMember[]> =>
    apiClient.get<WorkspaceMember[]>(ApiRoutes.members.list(workspaceId)),

  updateRole: (
    workspaceId: string,
    memberId: string,
    payload: UpdateMemberRolePayload,
  ): Promise<WorkspaceMember> =>
    apiClient.patch<WorkspaceMember>(ApiRoutes.members.updateRole(workspaceId, memberId), payload),

  /** Also the "leave" call, when `memberId` is the caller's own membership. */
  remove: (workspaceId: string, memberId: string): Promise<RemoveMemberResult> =>
    apiClient.delete<RemoveMemberResult>(ApiRoutes.members.remove(workspaceId, memberId)),

  transferOwnership: (workspaceId: string, memberId: string): Promise<WorkspaceMember> =>
    apiClient.post<WorkspaceMember>(ApiRoutes.members.transferOwnership(workspaceId, memberId)),
};
