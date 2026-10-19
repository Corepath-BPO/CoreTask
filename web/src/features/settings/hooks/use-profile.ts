import { ApiRoutes } from '@coretask/contracts';
import type { AuthUser, UpdateProfilePayload } from '@coretask/types';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';
import { useAuthStore } from '@/stores/auth.store';

/** Saves the caller's own profile, and shows it everywhere their name is. */
export function useUpdateProfile() {
  const setUser = useAuthStore((state) => state.setUser);
  return useMutation({
    mutationFn: (payload: UpdateProfilePayload) =>
      apiClient.patch<AuthUser>(ApiRoutes.profile, payload),
    onSuccess: (user) => {
      setUser(user);
      // Member lists carry the title and the time off beside each name.
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.all });
      toast.success('Profile saved.');
    },
    onError: (error) =>
      toast.error(error instanceof ApiError ? error.message : 'Could not save your profile.'),
  });
}
