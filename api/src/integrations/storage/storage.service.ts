import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import { ALLOWED_UPLOAD_MIME_TYPES } from '@coretask/contracts';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';

export interface UploadCandidate {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Object-storage foundation (MinIO locally, any S3-compatible service in
 * production).
 *
 * Validation lives here rather than in a controller so every future upload path
 * — REST multipart, presigned direct-to-bucket, worker-side imports — is held to
 * the same limits.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly config: AppConfigService) {}

  get bucket(): string {
    return this.config.storage.bucket;
  }

  get maxFileSizeBytes(): number {
    return this.config.storage.maxFileSizeBytes;
  }

  /** Throws `AppException` when the file may not be accepted. */
  assertUploadAllowed(candidate: UploadCandidate): void {
    if (candidate.sizeBytes > this.maxFileSizeBytes) {
      throw AppException.badRequest('PAYLOAD_TOO_LARGE', undefined, {
        maxBytes: this.maxFileSizeBytes,
        actualBytes: candidate.sizeBytes,
      });
    }

    const mimeType = candidate.mimeType.split(';')[0]?.trim().toLowerCase() ?? '';

    if (!ALLOWED_UPLOAD_MIME_TYPES.includes(mimeType)) {
      throw AppException.badRequest('UNSUPPORTED_MEDIA_TYPE', undefined, {
        allowed: ALLOWED_UPLOAD_MIME_TYPES,
        actual: mimeType,
      });
    }
  }

  /**
   * Builds the storage key for an upload.
   *
   * The workspace id is the first path segment so that a bucket policy or
   * lifecycle rule can be scoped per tenant. The client-supplied filename never
   * reaches the key — only its extension does.
   */
  buildObjectKey(workspaceId: string, filename: string): string {
    const extension = extname(filename)
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    return `workspaces/${workspaceId}/${randomUUID()}${extension}`;
  }

  /**
   * Public URL for an object in a path-style bucket.
   *
   * Presigned upload/download URLs are the next step here; they need
   * `@aws-sdk/client-s3`, which is deliberately not a dependency until an
   * endpoint actually uploads something.
   */
  buildObjectUrl(objectKey: string): string {
    const { endpoint, bucket, forcePathStyle } = this.config.storage;
    const base = endpoint.replace(/\/$/, '');

    return forcePathStyle
      ? `${base}/${bucket}/${objectKey}`
      : `${base.replace('://', `://${bucket}.`)}/${objectKey}`;
  }
}
