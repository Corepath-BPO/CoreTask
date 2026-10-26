import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

import { ApiError } from '@/lib/api/api-error';
import { queryClient, queryKeys } from '@/lib/api/query-client';

import { attachmentsApi, uploadToStorage, type AttachmentParent } from '../api/attachments.api';

function reportError(error: unknown, fallback: string) {
  toast.error(error instanceof ApiError ? error.message : fallback);
}

async function invalidate(workspaceId: string, parent: AttachmentParent) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: queryKeys.attachments.forParent(workspaceId, parent.kind, parent.id),
    }),
    queryClient.invalidateQueries({ queryKey: queryKeys.activity.all(workspaceId) }),
  ]);
}

export function useAttachments(workspaceId: string | undefined, parent: AttachmentParent | null) {
  return useQuery({
    queryKey: queryKeys.attachments.forParent(
      workspaceId ?? '',
      parent?.kind ?? '',
      parent?.id ?? '',
    ),
    queryFn: () => attachmentsApi.list(workspaceId as string, parent as AttachmentParent),
    enabled: Boolean(workspaceId) && Boolean(parent),
  });
}

/**
 * Runs the whole upload: declare, PUT to storage, confirm.
 *
 * All three steps live in one mutation because a partial run is not a state
 * anyone should have to reason about — a declared attachment with no bytes is
 * invisible until confirmed, and gets swept up later, so failing anywhere in
 * here simply means nothing happened.
 */
export function useUploadAttachment(
  workspaceId: string | undefined,
  parent: AttachmentParent | null,
) {
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
    }: {
      file: File;
      onProgress?: (fraction: number) => void;
    }) => {
      const target = parent as AttachmentParent;
      const upload = await attachmentsApi.create(workspaceId as string, {
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        ...(target.kind === 'task' ? { taskId: target.id } : { ticketId: target.id }),
      });

      await uploadToStorage(upload, file, onProgress);

      return attachmentsApi.confirm(workspaceId as string, upload.attachment.id);
    },
    onSuccess: async () => {
      await invalidate(workspaceId as string, parent as AttachmentParent);
    },
    onError: (error) => reportError(error, 'Could not upload the file.'),
  });
}

/**
 * Fetches a fresh download URL and follows it.
 *
 * Never held on to: the URL expires in minutes, so caching one would hand the
 * user a link that is dead by the time they click it.
 */
export function useDownloadAttachment(workspaceId: string | undefined) {
  return useMutation({
    mutationFn: (attachmentId: string) =>
      attachmentsApi.download(workspaceId as string, attachmentId),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
    onError: (error) => reportError(error, 'Could not download the file.'),
  });
}

export function useDeleteAttachment(
  workspaceId: string | undefined,
  parent: AttachmentParent | null,
) {
  return useMutation({
    mutationFn: (attachmentId: string) =>
      attachmentsApi.remove(workspaceId as string, attachmentId),
    onSuccess: async () => {
      toast.success('Attachment removed.');
      await invalidate(workspaceId as string, parent as AttachmentParent);
    },
    onError: (error) => reportError(error, 'Could not remove the attachment.'),
  });
}
