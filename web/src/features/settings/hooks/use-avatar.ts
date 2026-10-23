import type { AuthUser } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { useAuthStore } from '@/stores/auth.store';

import { accountApi, uploadPicture } from '../api/account.api';
import { squarePicture } from '../lib/square-picture';

/** The new picture shows on the menu at once, and on member lists when they refetch. */
function showEverywhere(user: AuthUser): void {
  useAuthStore.getState().setUser(user);
  void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
}

function messageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Crops, uploads and confirms a picture: three steps, one button. */
export function useUploadAvatar() {
  return useMutation({
    mutationFn: async (file: File) => {
      const picture = await squarePicture(file);
      const upload = await accountApi.createAvatarUpload({
        mimeType: picture.type,
        sizeBytes: picture.size,
      });
      await uploadPicture(upload, picture);
      return accountApi.confirmAvatarUpload(upload.uploadToken);
    },
    onSuccess: (user) => {
      showEverywhere(user);
      toast.success('Picture updated.');
    },
    onError: (error) => toast.error(messageOf(error, 'Could not change your picture.')),
  });
}

export function useRemoveAvatar() {
  return useMutation({
    mutationFn: () => accountApi.removeAvatar(),
    onSuccess: (user) => {
      showEverywhere(user);
      toast.success('Picture removed.');
    },
    onError: (error) => toast.error(messageOf(error, 'Could not remove your picture.')),
  });
}
