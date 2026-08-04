import { ApiRoutes } from '@coretask/contracts';
import type {
  Attachment,
  AttachmentDownload,
  CreateAttachmentPayload,
  PresignedUpload,
} from '@coretask/types';

import { apiClient } from '@/lib/api/client';

/** Which item the files hang off. */
export type AttachmentParent =
  | { kind: 'task'; id: string }
  /** `id` may be a UUID or a key such as `CORE-1001`. */
  | { kind: 'ticket'; id: string };

const listUrl = (workspaceId: string, parent: AttachmentParent) =>
  parent.kind === 'task'
    ? ApiRoutes.attachments.forTask(workspaceId, parent.id)
    : ApiRoutes.attachments.forTicket(workspaceId, parent.id);

export const attachmentsApi = {
  list: (workspaceId: string, parent: AttachmentParent): Promise<Attachment[]> =>
    apiClient.get<Attachment[]>(listUrl(workspaceId, parent)),

  create: (workspaceId: string, payload: CreateAttachmentPayload): Promise<PresignedUpload> =>
    apiClient.post<PresignedUpload>(ApiRoutes.attachments.create(workspaceId), payload),

  confirm: (workspaceId: string, attachmentId: string): Promise<Attachment> =>
    apiClient.post<Attachment>(ApiRoutes.attachments.confirm(workspaceId, attachmentId), {}),

  download: (workspaceId: string, attachmentId: string): Promise<AttachmentDownload> =>
    apiClient.get<AttachmentDownload>(ApiRoutes.attachments.download(workspaceId, attachmentId)),

  remove: (workspaceId: string, attachmentId: string): Promise<{ deleted: boolean }> =>
    apiClient.delete<{ deleted: boolean }>(ApiRoutes.attachments.remove(workspaceId, attachmentId)),
};

/**
 * PUTs the file straight to object storage.
 *
 * Deliberately `fetch` rather than the app's API client: this request goes to
 * the bucket, not the API, so it must not carry the access token or the
 * credentials the client attaches to same-origin calls. Sending them would leak
 * them to a different service for no reason.
 *
 * `XMLHttpRequest` rather than `fetch` because progress reporting on an upload
 * body is still not something `fetch` exposes, and a large file with no
 * feedback looks broken.
 */
export function uploadToStorage(
  upload: PresignedUpload,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', upload.uploadUrl, true);

    for (const [header, value] of Object.entries(upload.uploadHeaders)) {
      request.setRequestHeader(header, value);
    }

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
        return;
      }
      // The body is S3's XML error document, which is not worth showing anyone.
      reject(new Error(`Upload failed (${request.status})`));
    });

    request.addEventListener('error', () => reject(new Error('Upload failed.')));
    request.addEventListener('abort', () => reject(new Error('Upload cancelled.')));

    request.send(file);
  });
}
