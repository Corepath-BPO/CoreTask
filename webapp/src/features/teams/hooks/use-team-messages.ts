import { ApiRoutes } from '@coretask/contracts';
import type { PostProjectMessagePayload, TeamMessage } from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { apiClient } from '@/lib/api/client';
import { queryClient, queryKeys } from '@/lib/api/query-client';

const routes = ApiRoutes.teams;

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** A team's messages, newest first, with their replies. */
export function useTeamMessages(workspaceId: string | undefined, teamId: string) {
  return useQuery({
    queryKey: queryKeys.teams.messages(workspaceId ?? '', teamId),
    queryFn: () => apiClient.get<TeamMessage[]>(routes.messages(workspaceId as string, teamId)),
    enabled: Boolean(workspaceId && teamId),
  });
}

const refresh = (workspaceId: string, teamId: string) =>
  queryClient.invalidateQueries({ queryKey: queryKeys.teams.messages(workspaceId, teamId) });

export function usePostTeamMessage(workspaceId: string | undefined, teamId: string) {
  return useMutation({
    mutationFn: (payload: PostProjectMessagePayload) =>
      apiClient.post<TeamMessage>(routes.messages(workspaceId as string, teamId), payload),
    onSuccess: () => refresh(workspaceId as string, teamId),
    onError: (error) => report(error, 'Could not post the message.'),
  });
}

export function useReplyToTeamMessage(workspaceId: string | undefined, teamId: string) {
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: string }) =>
      apiClient.post<TeamMessage>(routes.replies(workspaceId as string, teamId, messageId), {
        body,
      }),
    onSuccess: () => refresh(workspaceId as string, teamId),
    onError: (error) => report(error, 'Could not post the reply.'),
  });
}

export function useDeleteTeamMessage(workspaceId: string | undefined, teamId: string) {
  return useMutation({
    mutationFn: (messageId: string) =>
      apiClient.delete<void>(routes.message(workspaceId as string, teamId, messageId)),
    onSuccess: () => refresh(workspaceId as string, teamId),
    onError: (error) => report(error, 'Could not delete the message.'),
  });
}
