import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { slackApi } from '../api/slack.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

/** Whether Slack is set up on this server, connected to the workspace, and linked for me. */
export function useSlackStatus(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.slack.status(workspaceId ?? ''),
    queryFn: () => slackApi.status(workspaceId as string),
    enabled: Boolean(workspaceId),
  });
}

/** Channels the Slack app can post to; asked of Slack, so only when a picker is open. */
export function useSlackChannels(workspaceId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.slack.channels(workspaceId ?? ''),
    queryFn: () => slackApi.channels(workspaceId as string),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60_000,
  });
}

/** "Add to Slack": off to Slack's consent page, which sends the browser back to the callback. */
export function useStartSlackInstall(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: () => slackApi.installUrl(workspaceId as string),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => reportError(error, 'Could not start connecting Slack.'),
  });
}

export function useDisconnectSlack(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: () => slackApi.disconnect(workspaceId as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.slack.all(workspaceId ?? '') });
      toast.success('Slack disconnected');
    },
    onError: (error) => reportError(error, 'Could not disconnect Slack.'),
  });
}

export function useUnlinkSlack(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: () => slackApi.unlinkMe(workspaceId as string),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.slack.all(workspaceId ?? '') });
      toast.success('Your Slack account is unlinked');
    },
    onError: (error) => reportError(error, 'Could not unlink your Slack account.'),
  });
}
