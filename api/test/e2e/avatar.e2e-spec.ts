import { API_PREFIX, AVATAR_MAX_BYTES } from '@coretask/contracts';
import request from 'supertest';

import { StorageService } from '../../src/integrations/storage/storage.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Profile pictures, against the real storage server the dev stack runs: the
 * point is what storage actually does with a presigned PUT — accepts any size,
 * refuses another content type — and that the API's confirm step is what
 * turns that into a rule.
 */
describe('Profile pictures (e2e)', () => {
  let context: TestContext;
  let storage: StorageService;

  beforeAll(async () => {
    context = await createTestContext();
    storage = context.app.get(StorageService);
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;

  interface Actor {
    token: string;
    userId: string;
  }

  const register = async (): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Ada Lovelace', email: uniqueEmail('avatar'), password: VALID_PASSWORD })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const declare = (actor: Actor, body: Record<string, unknown>) =>
    request(server())
      .post(url('/users/me/avatar'))
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);

  const confirm = (actor: Actor, uploadToken: string) =>
    request(server())
      .post(url('/users/me/avatar/confirm'))
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ uploadToken });

  /** The storage key a token carries. Sealed, not secret: anyone may read it. */
  const keyOf = (uploadToken: string): string =>
    JSON.parse(Buffer.from(uploadToken.split('.')[0] as string, 'base64url').toString('utf8')).d
      .key as string;

  /** Declares, PUTs and confirms; answers the confirmed user and the key. */
  const upload = async (actor: Actor, bytes: Buffer, mimeType = 'image/webp') => {
    const declared = await declare(actor, { mimeType, sizeBytes: bytes.length }).expect(201);
    const { uploadUrl, headers, uploadToken } = declared.body.data;
    const put = await fetch(uploadUrl, { method: 'PUT', headers, body: bytes });
    expect(put.ok).toBe(true);
    const confirmed = await confirm(actor, uploadToken).expect(200);
    return { user: confirmed.body.data, key: keyOf(uploadToken) };
  };

  const picture = (text = 'a square picture') => Buffer.from(text.padEnd(512, '.'));

  it('uploads, confirms and serves a picture through a redirect another origin may follow', async () => {
    const actor = await register();

    const declared = await declare(actor, { mimeType: 'image/webp', sizeBytes: 512 }).expect(201);
    expect(declared.body.data.uploadUrl).toContain('X-Amz-Signature');
    expect(declared.body.data.headers).toEqual({ 'Content-Type': 'image/webp' });
    expect(keyOf(declared.body.data.uploadToken)).toMatch(
      new RegExp(`^avatars/${actor.userId}/[0-9a-f-]{36}\\.webp$`),
    );

    const { user, key } = await upload(actor, picture());
    expect(user.id).toBe(actor.userId);
    expect(user.avatarUrl).toMatch(
      new RegExp(`/api/v1/users/${actor.userId}/avatar\\?v=[0-9a-f]{8}$`),
    );
    expect(
      await context.prisma.user.findUniqueOrThrow({
        where: { id: actor.userId },
        select: { avatarKey: true },
      }),
    ).toEqual({ avatarKey: key });

    // No token: it is an <img src>.
    const view = await request(server())
      .get(url(`/users/${actor.userId}/avatar`))
      .expect(302);
    expect(view.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(view.headers['cache-control']).toBe('private, max-age=240');
    expect(view.headers['location']).toContain('X-Amz-Signature');

    const served = await fetch(view.headers['location'] as string);
    expect(served.ok).toBe(true);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(Buffer.from(await served.arrayBuffer())).toEqual(picture());
  });

  it('a new picture replaces the old one, which is deleted, and so is an upload never confirmed', async () => {
    const actor = await register();
    const first = await upload(actor, picture('first'));

    // Declared and PUT, never confirmed: no row points at it.
    const abandoned = await declare(actor, { mimeType: 'image/png', sizeBytes: 512 }).expect(201);
    await fetch(abandoned.body.data.uploadUrl, {
      method: 'PUT',
      headers: abandoned.body.data.headers,
      body: picture('abandoned'),
    });
    const abandonedKey = keyOf(abandoned.body.data.uploadToken);
    expect(await storage.headObject(abandonedKey)).not.toBeNull();

    const second = await upload(actor, picture('second'), 'image/png');
    expect(second.user.avatarUrl).not.toBe(first.user.avatarUrl);
    expect(await storage.headObject(first.key)).toBeNull();
    expect(await storage.headObject(abandonedKey)).toBeNull();
    expect(await storage.headObject(second.key)).not.toBeNull();
  });

  it('removes the picture, the bytes with it, and the address then answers 404', async () => {
    const actor = await register();
    const { key } = await upload(actor, picture());

    const removed = await request(server())
      .delete(url('/users/me/avatar'))
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(200);

    expect(removed.body.data.avatarUrl).toBeNull();
    expect(await storage.headObject(key)).toBeNull();
    await request(server())
      .get(url(`/users/${actor.userId}/avatar`))
      .expect(404);
  });

  it('refuses, and deletes, an upload larger than was allowed', async () => {
    const actor = await register();
    const declared = await declare(actor, { mimeType: 'image/png', sizeBytes: 1024 }).expect(201);
    const { uploadUrl, headers, uploadToken } = declared.body.data;

    // A presigned PUT cannot cap the size; storage takes the lot.
    const oversize = Buffer.alloc(AVATAR_MAX_BYTES + 1, 1);
    expect((await fetch(uploadUrl, { method: 'PUT', headers, body: oversize })).ok).toBe(true);

    const refused = await confirm(actor, uploadToken).expect(400);
    expect(refused.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(await storage.headObject(keyOf(uploadToken))).toBeNull();

    const user = await context.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    expect(user.avatarKey).toBeNull();
    expect(user.avatarUrl).toBeNull();
  });

  it('refuses, and deletes, an object that is not the type it was declared as', async () => {
    const actor = await register();
    const declared = await declare(actor, { mimeType: 'image/png', sizeBytes: 64 }).expect(201);
    const { uploadToken } = declared.body.data;

    // The signed PUT itself refuses another type, so the mismatch is put
    // there the way only something with storage credentials could.
    const swapped = await fetch(declared.body.data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/html' },
      body: '<script>alert(1)</script>',
    });
    expect(swapped.ok).toBe(false);
    await storage.putObject(keyOf(uploadToken), Buffer.from('<svg/>'), 'image/svg+xml');

    const refused = await confirm(actor, uploadToken).expect(400);
    expect(refused.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(await storage.headObject(keyOf(uploadToken))).toBeNull();
  });

  it('refuses a declaration that is not a picture, or over the limit', async () => {
    const actor = await register();
    await declare(actor, { mimeType: 'image/svg+xml', sizeBytes: 100 }).expect(422);
    await declare(actor, { mimeType: 'image/png', sizeBytes: AVATAR_MAX_BYTES + 1 }).expect(422);
    await declare(actor, { mimeType: 'image/png' }).expect(422);
  });

  it('will not confirm someone else’s upload, a forged token, or nothing at all', async () => {
    const ada = await register();
    const grace = await register();

    const declared = await declare(ada, { mimeType: 'image/png', sizeBytes: 512 }).expect(201);
    const { uploadToken } = declared.body.data;

    // Nothing was PUT yet.
    await confirm(ada, uploadToken).expect(400);
    await fetch(declared.body.data.uploadUrl, {
      method: 'PUT',
      headers: declared.body.data.headers,
      body: picture(),
    });

    await confirm(grace, uploadToken).expect(400);
    const [payload] = uploadToken.split('.');
    await confirm(ada, `${payload}.forged`).expect(400);

    expect(
      (await context.prisma.user.findUniqueOrThrow({ where: { id: grace.userId } })).avatarKey,
    ).toBeNull();
    await confirm(ada, uploadToken).expect(200);
  });

  it('answers 404 for someone with no picture, and 400 for an id that is not one', async () => {
    const actor = await register();
    await request(server())
      .get(url(`/users/${actor.userId}/avatar`))
      .expect(404);
    await request(server()).get(url('/users/not-a-uuid/avatar')).expect(400);
  });

  it('needs a session for changing the picture', async () => {
    await request(server())
      .post(url('/users/me/avatar'))
      .send({ mimeType: 'image/png', sizeBytes: 10 })
      .expect(401);
    await request(server()).delete(url('/users/me/avatar')).expect(401);
  });
});
