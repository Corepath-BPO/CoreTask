import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from '@coretask/contracts';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { AppConfigService } from '../../config/app-config.service';

export interface UploadCandidate {
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** What storage actually holds, as opposed to what the uploader claimed. */
export interface StoredObject {
  sizeBytes: number;
  mimeType: string;
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
export class StorageService implements OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  /** Server-side calls: head, delete. Uses whatever address the API can reach. */
  private readonly client: S3Client;
  /**
   * Signing only, pointed at the address a *browser* can reach.
   *
   * A separate client rather than a rewrite of the finished URL, because SigV4
   * signs the Host header: changing the hostname afterwards invalidates the
   * signature. The URL has to be produced for the host the client will connect
   * to. When the two addresses are the same — the usual case against real S3 —
   * this is the same configuration twice, which costs nothing.
   */
  private readonly presigningClient: S3Client;

  constructor(private readonly config: AppConfigService) {
    const { endpoint, publicEndpoint, region, accessKey, secretKey, forcePathStyle } =
      config.storage;

    const base = {
      region,
      // MinIO serves one bucket per path segment rather than per subdomain, so
      // virtual-host addressing would resolve to a hostname that does not exist.
      forcePathStyle,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    };

    this.client = new S3Client({ ...base, endpoint });
    this.presigningClient =
      publicEndpoint === endpoint
        ? this.client
        : new S3Client({ ...base, endpoint: publicEndpoint });
  }

  onModuleDestroy(): void {
    this.client.destroy();
    if (this.presigningClient !== this.client) this.presigningClient.destroy();
  }

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
   * A short-lived URL the browser can PUT bytes to.
   *
   * The bytes never pass through the API. That keeps request memory and
   * timeouts bounded no matter how large the file is, and it is why nothing the
   * client declares can be trusted until {@link headObject} has looked at what
   * actually landed.
   *
   * `ContentType` is part of the signature, so the PUT must send exactly the
   * same value — the returned headers are not advisory.
   */
  async presignUpload(
    objectKey: string,
    mimeType: string,
  ): Promise<{ url: string; headers: Record<string, string>; expiresInSeconds: number }> {
    const url = await getSignedUrl(
      this.presigningClient,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: mimeType,
      }),
      {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        // Without this the signature covers only `host`, and `ContentType`
        // degrades to a suggestion: a URL signed for image/png happily accepts
        // text/html and stores it as such. Naming it here puts it in
        // SignedHeaders, so a mismatched upload fails the signature outright.
        // Verified against MinIO — it accepted the swap before this was added.
        signableHeaders: new Set(['content-type']),
      },
    );

    return {
      url,
      headers: { 'Content-Type': mimeType },
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    };
  }

  /**
   * A short-lived URL for reading one object back.
   *
   * Always forces a download rather than letting the browser render in place.
   * `image/svg+xml` is an accepted upload type and an SVG can carry script, so
   * rendering one inline would be stored XSS on the storage origin. Overriding
   * the disposition at signing time means the header cannot be dropped by
   * whatever wrote the object.
   */
  async presignDownload(
    objectKey: string,
    filename: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const url = await getSignedUrl(
      this.presigningClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ResponseContentDisposition: `attachment; filename="${sanitiseHeaderFilename(filename)}"`,
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );

    return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
  }

  /**
   * Reads back what storage holds, or null when nothing is there.
   *
   * This is the step that turns the client's declaration into a fact. Without
   * it, a presigned URL issued for "a 2 KB PNG" could receive anything at all.
   */
  async headObject(objectKey: string): Promise<StoredObject | null> {
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }),
      );

      return {
        sizeBytes: head.ContentLength ?? 0,
        mimeType: (head.ContentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '',
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Deleting something that is not there is a success, not an error. */
  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }));
    } catch (error) {
      if (isNotFound(error)) return;
      this.logger.error({ objectKey, error }, 'Failed to delete stored object');
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}

/**
 * Makes a filename safe to place inside a quoted header parameter.
 *
 * The filename is validated on the way in, so this is the second of two layers
 * rather than the only one — it exists because this value is interpolated into
 * a header, and that is worth guarding at the point of use.
 */
function sanitiseHeaderFilename(filename: string): string {
  return [...filename]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .replace(/["\\]/g, '_')
    .slice(0, 200);
}
