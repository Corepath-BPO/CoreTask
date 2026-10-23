import { ApiRoutes } from '@coretask/contracts';
import type {
  AccountDeletionPreview,
  AuthUser,
  AvatarUpload,
  CreateAvatarUploadPayload,
  DeleteAccountPayload,
  DeleteWorkspacePayload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

/** The profile picture, and deleting things: the account, or a workspace. */
export const accountApi = {
  createAvatarUpload: (payload: CreateAvatarUploadPayload): Promise<AvatarUpload> =>
    apiClient.post<AvatarUpload>(ApiRoutes.avatar.upload, payload),

  confirmAvatarUpload: (uploadToken: string): Promise<AuthUser> =>
    apiClient.post<AuthUser>(ApiRoutes.avatar.confirm, { uploadToken }),

  removeAvatar: (): Promise<AuthUser> => apiClient.delete<AuthUser>(ApiRoutes.avatar.remove),

  deletionPreview: (): Promise<AccountDeletionPreview> =>
    apiClient.get<AccountDeletionPreview>(ApiRoutes.accountDeletion),

  deleteAccount: async (payload: DeleteAccountPayload): Promise<void> => {
    await apiClient.delete<void>(ApiRoutes.profile, { data: payload });
  },

  deleteWorkspace: async (workspaceId: string, payload: DeleteWorkspacePayload): Promise<void> => {
    await apiClient.delete<void>(ApiRoutes.workspaces.remove(workspaceId), { data: payload });
  },
};

/**
 * PUTs the picture straight to storage. `fetch`, not the API client: the
 * request goes to the bucket, which must not see the access token, and
 * exactly the signed headers go with it.
 */
export async function uploadPicture(upload: AvatarUpload, picture: Blob): Promise<void> {
  const response = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: upload.headers,
    body: picture,
  });
  if (!response.ok) throw new Error('The picture did not upload. Try again.');
}
