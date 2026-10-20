import { randomUUID } from 'node:crypto';

import { API_PREFIX, ApiRoutes, AVATAR_MAX_BYTES, AVATAR_MIME_TYPES } from '@coretask/contracts';
import type { AuthUser, AvatarUpload, CreateAvatarUploadPayload } from '@coretask/types';
import { Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { openToken, sealToken } from '../../common/utils/sealed-token';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { deriveKey } from '../webhooks/lib/secret-cipher';

import { UsersService } from './users.service';

const UPLOAD_TOKEN_PURPOSE = 'avatar-upload';
/** Long enough to choose, crop and send a picture on a slow connection. */
const UPLOAD_TOKEN_TTL_SECONDS = 15 * 60;

/** The extension each accepted type is stored under; the type is read back from it. */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const TYPE_BY_EXTENSION = new Map(
  Object.entries(EXTENSION_BY_TYPE).map(([type, extension]) => [extension, type]),
);

/** What an upload token vouches for: whose picture, where it goes, and what it is. */
interface UploadClaim {
  userId: string;
  key: string;
  mimeType: string;
}

/**
 * Profile pictures, uploaded the way attachments are: the browser PUTs the
 * bytes straight to storage and the API looks at what landed before it counts.
 *
 * There is no row for an upload in progress. The key travels in a sealed
 * token instead, so a confirm can only ever point the account at an object
 * this service chose the name of, under that account's own prefix.
 *
 * `avatarUrl` stays the one field every projection reads. For an uploaded
 * picture it is this API's own address for it, which redirects to a
 * short-lived signed URL; a new picture changes the `?v=` so caches let go of
 * the old one.
 */
@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly sealKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {
    this.sealKey = deriveKey(`${config.webhooks.encryptionKeyMaterial}:avatars`);
  }

  /** Somewhere to PUT the picture. The type and size were checked by the schema. */
  async createUpload(userId: string, input: CreateAvatarUploadPayload): Promise<AvatarUpload> {
    const extension = EXTENSION_BY_TYPE[input.mimeType];
    if (!extension) {
      throw AppException.badRequest('UNSUPPORTED_MEDIA_TYPE', undefined, {
        allowed: AVATAR_MIME_TYPES,
        actual: input.mimeType,
      });
    }

    const key = `${prefixFor(userId)}${randomUUID()}${extension}`;
    const upload = await this.storage.presignUpload(key, input.mimeType);
    const claim: UploadClaim = { userId, key, mimeType: input.mimeType };

    return {
      uploadUrl: upload.url,
      headers: upload.headers,
      expiresInSeconds: upload.expiresInSeconds,
      uploadToken: sealToken(this.sealKey, UPLOAD_TOKEN_PURPOSE, claim, UPLOAD_TOKEN_TTL_SECONDS),
    };
  }

  /**
   * Makes the uploaded picture the account's, once what landed is known to be
   * a picture of the size and type that was asked for. A presigned PUT cannot
   * cap the size, so this is the check that does; anything that fails it is
   * deleted at once rather than left to cost money.
   */
  async confirm(userId: string, uploadToken: string): Promise<AuthUser> {
    const claim = openToken<UploadClaim>(this.sealKey, UPLOAD_TOKEN_PURPOSE, uploadToken);
    if (!claim || claim.userId !== userId || !claim.key.startsWith(prefixFor(userId))) {
      throw AppException.badRequest(
        'BAD_REQUEST',
        'This upload has expired. Choose the picture again.',
      );
    }

    const stored = await this.storage.headObject(claim.key);
    if (!stored) {
      throw AppException.badRequest('BAD_REQUEST', 'No picture arrived. Try uploading it again.');
    }

    if (stored.sizeBytes > AVATAR_MAX_BYTES) {
      await this.discard([claim.key]);
      throw AppException.badRequest(
        'PAYLOAD_TOO_LARGE',
        `Use a picture under ${AVATAR_MAX_BYTES / 1024 / 1024} MB.`,
        { maxBytes: AVATAR_MAX_BYTES, actualBytes: stored.sizeBytes },
      );
    }
    if (!AVATAR_MIME_TYPES.includes(stored.mimeType) || stored.mimeType !== claim.mimeType) {
      await this.discard([claim.key]);
      throw AppException.badRequest(
        'UNSUPPORTED_MEDIA_TYPE',
        'The picture is not the type it was declared as. Use a PNG, JPEG, WebP or GIF.',
        { allowed: AVATAR_MIME_TYPES, actual: stored.mimeType },
      );
    }

    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: claim.key, avatarUrl: this.urlFor(userId, claim.key) },
    });

    // The old picture, and any upload that was never confirmed, go now.
    await this.sweep(userId, { keep: claim.key, also: previous?.avatarKey ?? null });
    return UsersService.toAuthUser(user);
  }

  /** Back to the monogram. Clears a picture from anywhere, uploaded or not. */
  async remove(userId: string): Promise<AuthUser> {
    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarKey: null, avatarUrl: null },
    });

    await this.sweep(userId, { keep: null, also: previous?.avatarKey ?? null });
    return UsersService.toAuthUser(user);
  }

  /**
   * Every object under the account's prefix, for deleting the account. The
   * caller clears the columns along with the rest of the row.
   */
  async discardAll(userId: string, currentKey: string | null): Promise<void> {
    await this.sweep(userId, { keep: null, also: currentKey });
  }

  /** A signed URL that shows the picture, or 404 when there is none. */
  async view(userId: string): Promise<{ url: string; expiresInSeconds: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatarKey: true },
    });
    const mimeType = user?.avatarKey ? TYPE_BY_EXTENSION.get(extensionOf(user.avatarKey)) : null;
    if (!user?.avatarKey || !mimeType) {
      throw AppException.notFound('RESOURCE_NOT_FOUND', 'This person has no picture.');
    }
    return this.storage.presignView(user.avatarKey, mimeType);
  }

  /**
   * The address projections show: this API's redirect, with a version from
   * the key so a new picture is a new URL and nothing serves the old one.
   */
  private urlFor(userId: string, key: string): string {
    const apiUrl = this.config.http.apiUrl.replace(/\/$/, '');
    const version = key.slice(key.lastIndexOf('/') + 1, key.lastIndexOf('/') + 9);
    return `${apiUrl}${API_PREFIX}${ApiRoutes.avatar.view(userId)}?v=${version}`;
  }

  /**
   * Deletes what is under the account's prefix except the picture in use.
   * Listing rather than only deleting the previous key also catches uploads
   * that were never confirmed — a presigned PUT leaves no row behind to find
   * them by. Best effort: the account is already right, and a stray object
   * only costs storage.
   */
  private async sweep(
    userId: string,
    options: { keep: string | null; also: string | null },
  ): Promise<void> {
    try {
      const keys = await this.storage.listObjectKeys(prefixFor(userId));
      if (options.also) keys.push(options.also);
      await this.discard(keys.filter((key) => key !== options.keep));
    } catch (error) {
      this.logger.warn({ err: error, userId }, 'Could not clear old profile pictures');
    }
  }

  private async discard(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { failed } = await this.storage.deleteObjects(keys);
    if (failed > 0) this.logger.warn({ failed }, 'Some profile pictures could not be deleted');
  }
}

function prefixFor(userId: string): string {
  return `avatars/${userId}/`;
}

function extensionOf(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot === -1 ? '' : key.slice(dot).toLowerCase();
}
