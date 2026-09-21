import { DOWNLOAD_URL_TTL_SECONDS } from '@coretask/contracts';
import type { AttachmentDownload } from '@coretask/types';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/lib/api/query-client';

import { attachmentsApi } from '../api/attachments.api';

/** Refreshed a little before the URL expires, so a picture never goes stale on screen. */
const FRESH_FOR_MS = (DOWNLOAD_URL_TTL_SECONDS - 30) * 1000;

/**
 * The URL an inline image renders from.
 *
 * A description stores the attachment's id, never a URL: the bucket is private
 * and every link to it expires. So the picture is resolved by whoever is
 * looking, when they look, and cached only as long as the link lasts.
 */
export function useAttachmentViewUrl(
  workspaceId: string | undefined,
  attachmentId: string | null | undefined,
) {
  return useQuery<AttachmentDownload>({
    queryKey: [...queryKeys.attachments.all(workspaceId ?? ''), 'view', attachmentId ?? ''],
    queryFn: () => attachmentsApi.view(workspaceId as string, attachmentId as string),
    enabled: Boolean(workspaceId && attachmentId),
    staleTime: FRESH_FOR_MS,
    gcTime: FRESH_FOR_MS,
    // A 404 is a deleted attachment; a 400 is not a picture. Neither
    // improves on retry.
    retry: false,
  });
}
