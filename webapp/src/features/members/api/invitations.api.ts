import { ApiRoutes } from '@coretask/contracts';
import type {
  AcceptInvitationResult,
  CreateInvitationPayload,
  WorkspaceInvitation,
  WorkspaceInvitationPreview,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

export const invitationsApi = {
  list: (workspaceId: string): Promise<WorkspaceInvitation[]> =>
    apiClient.get<WorkspaceInvitation[]>(ApiRoutes.invitations.list(workspaceId)),

  create: (workspaceId: string, payload: CreateInvitationPayload): Promise<WorkspaceInvitation> =>
    apiClient.post<WorkspaceInvitation>(ApiRoutes.invitations.create(workspaceId), payload),

  revoke: (workspaceId: string, invitationId: string): Promise<void> =>
    apiClient.delete<void>(ApiRoutes.invitations.revoke(workspaceId, invitationId)),

  /** Readable without a session — the recipient usually has no account yet. */
  preview: (token: string): Promise<WorkspaceInvitationPreview> =>
    apiClient.get<WorkspaceInvitationPreview>(ApiRoutes.invitations.preview(token)),

  accept: (token: string): Promise<AcceptInvitationResult> =>
    apiClient.post<AcceptInvitationResult>(ApiRoutes.invitations.accept(token)),
};
