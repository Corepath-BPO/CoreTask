import type { AttachmentStatus } from '@coretask/contracts';

import type { UserRef } from './work-items.js';

/**
 * A file stored in object storage, hanging off a task or a ticket.
 *
 * Only confirmed uploads are ever returned by the API, so anything the client
 * sees has been verified against what storage actually holds.
 */
export interface Attachment {
  id: string;
  workspaceId: string;
  taskId: string | null;
  ticketId: string | null;
  filename: string;
  mimeType: string;
  /** Actual stored size, not what the uploader claimed. */
  sizeBytes: number;
  status: AttachmentStatus;
  /** Null when the uploader's account has since been removed. */
  uploadedBy: UserRef | null;
  createdAt: string;
}

/** What the client declares before it is given somewhere to upload to. */
export interface CreateAttachmentPayload {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  taskId?: string;
  ticketId?: string;
}

/**
 * The reply to a create: a row that does not have its bytes yet, and a
 * short-lived URL to PUT them to.
 */
export interface PresignedUpload {
  attachment: Attachment;
  uploadUrl: string;
  /** Headers the PUT must carry for the signature to validate. */
  uploadHeaders: Record<string, string>;
  expiresInSeconds: number;
}

/** A short-lived URL for retrieving one file. */
export interface AttachmentDownload {
  url: string;
  expiresInSeconds: number;
}
