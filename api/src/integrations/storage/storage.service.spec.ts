import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { DOWNLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from '@coretask/contracts';
import { Logger } from '@nestjs/common';

import { AppException } from '../../common/exceptions/app.exception';
import { type StorageConfig } from '../../config/app-config.service';

import { StorageService } from './storage.service';

/**
 * Nothing here reaches a server: presigning is local arithmetic, and every
 * other call is answered by a stub on `S3Client.send`. Whether a real server
 * honours what is signed is attachments.e2e-spec.ts's job (RustFS) and the
 * `storage:check` script's (R2).
 */
describe('StorageService', () => {
  /** Cloudflare R2's shape: one address for the server and the browser. */
  const r2: StorageConfig = {
    endpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    publicEndpoint: 'https://0123456789abcdef.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'coretask-test',
    accessKey: 'test-access-key-never-sent',
    secretKey: 'test-secret-key-never-sent',
    forcePathStyle: true,
    maxFileSizeBytes: 25 * 1024 * 1024,
  };
  /** The dev stack's shape: a compose-network host the browser cannot reach. */
  const docker: StorageConfig = {
    ...r2,
    endpoint: 'http://coretask-storage:9000',
    publicEndpoint: 'http://localhost:9000',
    region: 'us-east-1',
  };

  const build = (storage: StorageConfig = r2) => new StorageService({ storage } as never);

  let send: jest.SpyInstance;
  let logError: jest.SpyInstance;

  beforeEach(() => {
    send = jest.spyOn(S3Client.prototype, 'send');
    logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    send.mockRestore();
    logError.mockRestore();
  });

  /** The command the service sent on call `index`, typed as `type`. */
  const sent = <T>(type: new (...args: never[]) => T, index = 0): T => {
    const command = send.mock.calls[index]?.[0] as unknown;
    expect(command).toBeInstanceOf(type);
    return command as T;
  };

  const s3Error = (name: string, httpStatusCode: number) =>
    Object.assign(new Error(name), { name, $metadata: { httpStatusCode } });

  describe('presignUpload', () => {
    it('signs a path-style PUT on the R2 endpoint with Content-Type in the signature', async () => {
      const upload = await build().presignUpload('workspaces/w1/a.png', 'image/png');
      const url = new URL(upload.url);

      expect(url.origin).toBe(r2.endpoint);
      expect(url.pathname).toBe('/coretask-test/workspaces/w1/a.png');
      expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(
        expect.arrayContaining(['content-type', 'host']),
      );
      expect(url.searchParams.get('X-Amz-Credential')).toMatch(/\/auto\/s3\/aws4_request$/);
      expect(url.searchParams.get('X-Amz-Expires')).toBe(String(UPLOAD_URL_TTL_SECONDS));
      expect(upload).toMatchObject({
        headers: { 'Content-Type': 'image/png' },
        expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
      });
    });

    it('signs no checksum, which a browser upload could never match', async () => {
      // The SDK's default signs the CRC32 of an empty body into the URL.
      const { url } = await build().presignUpload('workspaces/w1/a.png', 'image/png');

      expect([...new URL(url).searchParams.keys()].filter((key) => /checksum/i.test(key))).toEqual(
        [],
      );
    });

    it('signs for the address the browser can reach, not the compose-network one', async () => {
      const { url } = await build(docker).presignUpload('workspaces/w1/a.png', 'image/png');

      expect(new URL(url).origin).toBe('http://localhost:9000');
      expect(new URL(url).searchParams.get('X-Amz-Credential')).toMatch(/\/us-east-1\/s3\//);
    });
  });

  describe('presignDownload', () => {
    it('always forces a download, whatever the stored type', async () => {
      const download = await build().presignDownload('workspaces/w1/a.svg', 'logo.svg');
      const url = new URL(download.url);

      expect(url.searchParams.get('response-content-disposition')).toBe(
        'attachment; filename="logo.svg"',
      );
      expect(url.searchParams.get('X-Amz-Expires')).toBe(String(DOWNLOAD_URL_TTL_SECONDS));
      expect(download.expiresInSeconds).toBe(DOWNLOAD_URL_TTL_SECONDS);
    });

    it('cannot be broken out of the quoted filename', async () => {
      const { url } = await build().presignDownload(
        'workspaces/w1/a.txt',
        `a"b\\c\r\nSet-Cookie: x\u0000${'z'.repeat(300)}`,
      );
      const disposition = new URL(url).searchParams.get('response-content-disposition') ?? '';
      const filename = /^attachment; filename="(.*)"$/.exec(disposition)?.[1] ?? '';

      expect(filename.startsWith('a_b_cSet-Cookie: x')).toBe(true);
      expect([...filename].filter((character) => '"\\\r\n\u0000'.includes(character))).toEqual([]);
      expect(filename).toHaveLength(200);
    });
  });

  describe('presignView', () => {
    it('renders inline as the type the caller checked', async () => {
      const { url } = await build().presignView('workspaces/w1/a.png', 'image/png');
      const params = new URL(url).searchParams;

      expect(params.get('response-content-disposition')).toBe('inline');
      expect(params.get('response-content-type')).toBe('image/png');
    });
  });

  describe('assertUploadAllowed', () => {
    const code = (run: () => void) => {
      try {
        run();
      } catch (error) {
        return (error as AppException).code;
      }
      return null;
    };

    it('accepts an allowed type, ignoring case and parameters', () => {
      expect(
        code(() =>
          build().assertUploadAllowed({
            filename: 'a.txt',
            mimeType: 'Text/Plain; charset=utf-8',
            sizeBytes: 10,
          }),
        ),
      ).toBeNull();
    });

    it('accepts the video types screen recordings come in', () => {
      for (const mimeType of ['video/mp4', 'video/webm', 'video/quicktime']) {
        expect(
          code(() =>
            build().assertUploadAllowed({ filename: 'walkthrough', mimeType, sizeBytes: 10 }),
          ),
        ).toBeNull();
      }
    });

    it('refuses a file over the size limit', () => {
      expect(
        code(() =>
          build().assertUploadAllowed({
            filename: 'a.png',
            mimeType: 'image/png',
            sizeBytes: r2.maxFileSizeBytes + 1,
          }),
        ),
      ).toBe('PAYLOAD_TOO_LARGE');
    });

    it('refuses a type that is not on the list', () => {
      expect(
        code(() =>
          build().assertUploadAllowed({
            filename: 'a.html',
            mimeType: 'text/html',
            sizeBytes: 10,
          }),
        ),
      ).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('buildObjectKey', () => {
    it('keys by workspace and a fresh id, keeping only a clean extension', () => {
      const key = build().buildObjectKey('ws-1', '../../Quarterly Report.P D!F');

      expect(key).toMatch(/^workspaces\/ws-1\/[0-9a-f-]{36}\.pdf$/);
      expect(key).not.toContain('Quarterly');
    });

    it('never repeats a key for the same name', () => {
      const service = build();
      expect(service.buildObjectKey('ws-1', 'a.png')).not.toBe(
        service.buildObjectKey('ws-1', 'a.png'),
      );
    });
  });

  describe('headObject', () => {
    it('answers what storage holds, with the type normalised', async () => {
      send.mockResolvedValue({ ContentLength: 42, ContentType: 'Image/PNG; charset=binary' });

      await expect(build().headObject('workspaces/w1/a.png')).resolves.toEqual({
        sizeBytes: 42,
        mimeType: 'image/png',
      });
      expect(sent(HeadObjectCommand).input).toEqual({
        Bucket: 'coretask-test',
        Key: 'workspaces/w1/a.png',
      });
    });

    it('answers null when nothing is there', async () => {
      send.mockRejectedValue(s3Error('NotFound', 404));

      await expect(build().headObject('workspaces/w1/missing.png')).resolves.toBeNull();
    });

    it('lets any other failure through', async () => {
      send.mockRejectedValue(s3Error('AccessDenied', 403));

      await expect(build().headObject('workspaces/w1/a.png')).rejects.toThrow('AccessDenied');
    });
  });

  describe('putObject', () => {
    it('writes the bytes with their type and length', async () => {
      send.mockResolvedValue({});
      const body = Buffer.from('hello');

      await build().putObject('workspaces/w1/a.txt', body, 'text/plain');

      expect(sent(PutObjectCommand).input).toEqual({
        Bucket: 'coretask-test',
        Key: 'workspaces/w1/a.txt',
        Body: body,
        ContentType: 'text/plain',
        ContentLength: 5,
      });
    });
  });

  describe('deleteObject', () => {
    it('deletes the key from the bucket', async () => {
      send.mockResolvedValue({});

      await build().deleteObject('workspaces/w1/a.txt');

      expect(sent(DeleteObjectCommand).input).toEqual({
        Bucket: 'coretask-test',
        Key: 'workspaces/w1/a.txt',
      });
    });

    it('treats a key that is already gone as deleted', async () => {
      send.mockRejectedValue(s3Error('NoSuchKey', 404));

      await expect(build().deleteObject('workspaces/w1/gone.txt')).resolves.toBeUndefined();
    });

    it('lets any other failure through', async () => {
      send.mockRejectedValue(s3Error('InternalError', 500));

      await expect(build().deleteObject('workspaces/w1/a.txt')).rejects.toThrow('InternalError');
      expect(logError).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteObjects', () => {
    it('sends each distinct key once, a thousand to a request', async () => {
      send.mockResolvedValue({});
      const keys = Array.from({ length: 2_500 }, (_, index) => `k${index}`);

      await expect(build().deleteObjects([...keys, 'k0', 'k1'])).resolves.toEqual({ failed: 0 });

      const batches = send.mock.calls.map(
        ([command]) => (command as DeleteObjectsCommand).input.Delete?.Objects ?? [],
      );
      expect(batches.map((batch) => batch.length)).toEqual([1_000, 1_000, 500]);
      expect(batches.flat().map((entry) => entry.Key)).toEqual(keys);
      expect(sent(DeleteObjectsCommand).input).toMatchObject({
        Bucket: 'coretask-test',
        Delete: { Quiet: true },
      });
    });

    it('counts the keys storage could not delete, but not ones already gone', async () => {
      send.mockResolvedValue({
        Errors: [
          { Key: 'a', Code: 'AccessDenied' },
          { Key: 'b', Code: 'NoSuchKey' },
        ],
      });

      await expect(build().deleteObjects(['a', 'b', 'c'])).resolves.toEqual({ failed: 1 });
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('counts a whole batch as failed when the request itself fails, and carries on', async () => {
      send.mockRejectedValueOnce(s3Error('InternalError', 500)).mockResolvedValueOnce({});
      const keys = Array.from({ length: 1_200 }, (_, index) => `k${index}`);

      await expect(build().deleteObjects(keys)).resolves.toEqual({ failed: 1_000 });
      expect(send).toHaveBeenCalledTimes(2);
      expect(logError).toHaveBeenCalledTimes(1);
    });

    it('sends nothing for no keys', async () => {
      await expect(build().deleteObjects([])).resolves.toEqual({ failed: 0 });
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('listObjectKeys', () => {
    it('follows continuation tokens to the end of the prefix', async () => {
      send
        .mockResolvedValueOnce({
          Contents: [{ Key: 'avatars/u1/a.png' }, { Key: 'avatars/u1/b.png' }],
          IsTruncated: true,
          NextContinuationToken: 'next',
        })
        .mockResolvedValueOnce({ Contents: [{ Key: 'avatars/u1/c.png' }], IsTruncated: false });

      await expect(build().listObjectKeys('avatars/u1/')).resolves.toEqual([
        'avatars/u1/a.png',
        'avatars/u1/b.png',
        'avatars/u1/c.png',
      ]);
      expect(sent(ListObjectsV2Command, 0).input).toEqual({
        Bucket: 'coretask-test',
        Prefix: 'avatars/u1/',
      });
      expect(sent(ListObjectsV2Command, 1).input).toEqual({
        Bucket: 'coretask-test',
        Prefix: 'avatars/u1/',
        ContinuationToken: 'next',
      });
    });

    it('answers an empty list for an empty prefix', async () => {
      send.mockResolvedValue({});

      await expect(build().listObjectKeys('avatars/nobody/')).resolves.toEqual([]);
    });
  });

  describe('clients', () => {
    it('sends server-side requests without the optional CRC32 checksum', async () => {
      const headers: Record<string, string>[] = [];
      // The real `send`, so the request is built and signed for real.
      send.mockRestore();
      const service = build();
      const client = (service as unknown as { client: S3Client }).client;
      client.middlewareStack.add(
        (_next) => (args) => {
          headers.push({ ...(args.request as { headers: Record<string, string> }).headers });
          return Promise.reject(new Error('stopped before the network'));
        },
        { step: 'finalizeRequest', priority: 'low' },
      );

      await expect(
        service.putObject('workspaces/w1/a.txt', Buffer.from('x'), 'text/plain'),
      ).rejects.toThrow('stopped before the network');

      expect(Object.keys(headers[0] ?? {}).filter((name) => /checksum/i.test(name))).toEqual([]);
    });

    it('closes both clients on shutdown, and a shared one once', () => {
      const destroy = jest.spyOn(S3Client.prototype, 'destroy');

      build(docker).onModuleDestroy();
      expect(destroy).toHaveBeenCalledTimes(2);

      destroy.mockClear();
      build(r2).onModuleDestroy();
      expect(destroy).toHaveBeenCalledTimes(1);

      destroy.mockRestore();
    });
  });
});
