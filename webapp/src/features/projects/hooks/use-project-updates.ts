import type { ProjectStatusValue } from '@coretask/contracts';
import type {
  PostProjectMessagePayload,
  ProjectStatusUpdate as ServerStatusUpdate,
  UpdateAuthor,
} from '@coretask/types';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { useActiveWorkspace } from '@/features/workspaces/hooks/use-workspaces';
import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { projectUpdatesApi } from '../api/project-updates.api';

/**
 * Status updates, messages and files, from the server.
 *
 * Status updates used to live in this browser alone; they are posted to the
 * API now, so a teammate sees the status somebody set and the project's
 * members hear about it. The screens keep the lowercase values they were
 * built on — `on_track` — and this module translates at the edge.
 */

export type ProjectStatusUpdateValue =
  'on_track' | 'at_risk' | 'off_track' | 'on_hold' | 'complete' | 'dropped';

export interface ProjectStatusUpdate {
  id: string;
  status: ProjectStatusUpdateValue;
  /** The composer's heading, e.g. "Platform — Aug 18". */
  title: string | null;
  /** The "Summary" section. */
  note: string | null;
  /** The "Next steps" section. */
  nextSteps: string | null;
  updatedAt: string;
  author: UpdateAuthor | null;
}

export const toServerStatus = (value: ProjectStatusUpdateValue): ProjectStatusValue =>
  value.toUpperCase() as ProjectStatusValue;

export function fromServerUpdate(update: ServerStatusUpdate): ProjectStatusUpdate {
  return {
    id: update.id,
    status: update.status.toLowerCase() as ProjectStatusUpdateValue,
    title: update.title,
    note: update.summary,
    nextSteps: update.nextSteps,
    updatedAt: update.createdAt,
    author: update.author,
  };
}

const report = (error: unknown, fallback: string) =>
  toast.error(error instanceof ApiError ? error.message : fallback);

/** Every visible project's newest update, keyed by project — one request for all of them. */
export function useLatestStatusUpdates(workspaceId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.projectUpdates.latestStatus(workspaceId ?? ''),
    queryFn: () => projectUpdatesApi.latestStatus(workspaceId as string),
    enabled: Boolean(workspaceId),
    select: (updates): Record<string, ProjectStatusUpdate> =>
      Object.fromEntries(updates.map((update) => [update.projectId, fromServerUpdate(update)])),
  });
}

/** A project's current status — its newest update — or null when it has none. */
export function useProjectStatusUpdate(projectId: string): ProjectStatusUpdate | null {
  const { workspace } = useActiveWorkspace();
  const { data } = useLatestStatusUpdates(workspace?.id);
  return data?.[projectId] ?? null;
}

export function useStatusUpdateHistory(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectUpdates.statusUpdates(workspaceId ?? '', projectId),
    queryFn: () => projectUpdatesApi.statusUpdates(workspaceId as string, projectId),
    enabled: Boolean(workspaceId && projectId),
    select: (updates) => updates.map(fromServerUpdate),
  });
}

/** Everything a post or a deletion makes stale: the statuses, the feed, the activity. */
const refresh = (workspaceId: string) =>
  Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.projectUpdates.all(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) }),
  ]);

export function usePostStatusUpdate(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (input: {
      status: ProjectStatusUpdateValue;
      title: string;
      note: string | null;
      nextSteps: string | null;
    }) =>
      projectUpdatesApi.postStatusUpdate(workspaceId as string, projectId, {
        status: toServerStatus(input.status),
        title: input.title,
        summary: input.note,
        nextSteps: input.nextSteps,
      }),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not post the update.'),
  });
}

/**
 * The update a rule's "Draft an update with AI…" step left for review. Only
 * asked for by someone who may post one; a draft is not the project's status.
 * Under the updates key, so posting an update — which spends it — refreshes it.
 */
export function useProjectStatusDraft(
  workspaceId: string | undefined,
  projectId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.projectUpdates.statusDraft(workspaceId ?? '', projectId),
    queryFn: () => projectUpdatesApi.statusDraft(workspaceId as string, projectId),
    enabled: enabled && Boolean(workspaceId && projectId),
  });
}

export function useDiscardStatusDraft(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: () => projectUpdatesApi.discardStatusDraft(workspaceId as string, projectId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projectUpdates.statusDraft(workspaceId as string, projectId),
      });
      toast.success('Draft discarded');
    },
    onError: (error) => report(error, 'Could not discard the draft.'),
  });
}

/** "Request status update": asks the project's owner, and says who was asked. */
export function useRequestProjectStatus(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (projectId: string) =>
      projectUpdatesApi.requestStatusUpdate(workspaceId as string, projectId),
    onSuccess: (result) => toast.success(`Asked ${result.recipient.name} for a status update.`),
    onError: (error) => report(error, 'Could not ask for an update.'),
  });
}

export function useDeleteStatusUpdate(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (updateId: string) =>
      projectUpdatesApi.deleteStatusUpdate(workspaceId as string, projectId, updateId),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not delete the update.'),
  });
}

export function useProjectMessages(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectUpdates.messages(workspaceId ?? '', projectId),
    queryFn: () => projectUpdatesApi.messages(workspaceId as string, projectId),
    enabled: Boolean(workspaceId && projectId),
  });
}

export function usePostMessage(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (payload: PostProjectMessagePayload) =>
      projectUpdatesApi.postMessage(workspaceId as string, projectId, payload),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not post the message.'),
  });
}

export function useReplyToMessage(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: ({ messageId, body }: { messageId: string; body: string }) =>
      projectUpdatesApi.reply(workspaceId as string, projectId, messageId, body),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not post the reply.'),
  });
}

export function useDeleteMessage(workspaceId: string | undefined, projectId: string) {
  return useMutation({
    mutationFn: (messageId: string) =>
      projectUpdatesApi.deleteMessage(workspaceId as string, projectId, messageId),
    onSuccess: () => refresh(workspaceId as string),
    onError: (error) => report(error, 'Could not delete the message.'),
  });
}

export function useProjectFiles(workspaceId: string | undefined, projectId: string) {
  return useQuery({
    queryKey: queryKeys.projectUpdates.files(workspaceId ?? '', projectId),
    queryFn: () => projectUpdatesApi.files(workspaceId as string, projectId),
    enabled: Boolean(workspaceId && projectId),
  });
}
