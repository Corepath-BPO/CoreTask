import { ApiRoutes } from '@coretask/contracts';
import type {
  NotificationPreferences,
  UpdateNotificationPreferencesPayload,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient } from '@/lib/api/query-client';

const key = (workspaceId: string) => ['notification-preferences', workspaceId] as const;

/** Which notifications the reader also gets by email in this workspace. */
export function useNotificationPreferences(workspaceId: string | undefined) {
  return useQuery({
    queryKey: key(workspaceId ?? ''),
    queryFn: () =>
      apiClient.get<NotificationPreferences>(
        ApiRoutes.notificationPreferences(workspaceId as string),
      ),
    enabled: Boolean(workspaceId),
  });
}

export function useSaveNotificationPreferences(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (payload: UpdateNotificationPreferencesPayload) =>
      apiClient.put<NotificationPreferences>(
        ApiRoutes.notificationPreferences(workspaceId as string),
        payload,
      ),
    onSuccess: (preferences) => {
      queryClient.setQueryData(key(workspaceId as string), preferences);
      toast.success('Email settings saved.');
    },
    onError: (error) =>
      toast.error(
        error instanceof ApiError ? error.message : 'Could not save your email settings.',
      ),
  });
}
