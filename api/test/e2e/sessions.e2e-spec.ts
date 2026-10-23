import { API_PREFIX, REFRESH_TOKEN_COOKIE } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * The session list, and signing sessions out one at a time or all but this
 * one. A signed-out session must stop at its next request, not when its
 * access token happens to expire.
 */
describe('Sessions (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
    jest
      .spyOn(context.app.get(EmailQueue), 'enqueueEmailVerification')
      .mockResolvedValue(undefined);
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const refreshCookie = (headers: request.Response['headers']): string => {
    const raw = headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw].filter(Boolean);
    const match = cookies.find((cookie) => String(cookie).startsWith(`${REFRESH_TOKEN_COOKIE}=`));
    if (!match) throw new Error('No refresh cookie was set.');
    return String(match).split(';')[0] as string;
  };

  /** One account signed in on a laptop and a phone. */
  const twoDevices = async () => {
    const email = uniqueEmail('sessions');
    const laptop = await request(server())
      .post(url('/auth/register'))
      .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0')
      .send({ name: 'Grace Hopper', email, password: VALID_PASSWORD })
      .expect(201);
    const phone = await request(server())
      .post(url('/auth/login'))
      .set('User-Agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1')
      .send({ email, password: VALID_PASSWORD })
      .expect(200);
    return {
      laptop: {
        token: laptop.body.data.accessToken as string,
        cookie: refreshCookie(laptop.headers),
      },
      phone: { token: phone.body.data.accessToken as string, cookie: refreshCookie(phone.headers) },
    };
  };

  const list = async (token: string) =>
    (await request(server()).get(url('/auth/sessions')).set(bearer(token)).expect(200)).body
      .data as { id: string; current: boolean; userAgent: string; method: string }[];

  it('lists each device once, marks this one, and survives a refresh', async () => {
    const { laptop } = await twoDevices();

    // A refresh rotates the token but is still the same session.
    await request(server()).post(url('/auth/refresh')).set('Cookie', laptop.cookie).expect(200);

    const sessions = await list(laptop.token);
    expect(sessions).toHaveLength(2);
    const here = sessions.find((session) => session.current);
    expect(here?.userAgent).toContain('Windows');
    expect(here?.method).toBe('PASSWORD');
    expect(sessions.filter((session) => !session.current)[0]?.userAgent).toContain('iPhone');
  });

  it('signs out another session at once: its access token and its refresh both stop', async () => {
    const { laptop, phone } = await twoDevices();
    await request(server()).get(url('/auth/me')).set(bearer(phone.token)).expect(200);

    const phoneSession = (await list(laptop.token)).find((session) => !session.current);
    await request(server())
      .delete(url(`/auth/sessions/${phoneSession?.id}`))
      .set(bearer(laptop.token))
      .expect(204);

    const refused = await request(server())
      .get(url('/auth/me'))
      .set(bearer(phone.token))
      .expect(401);
    expect(refused.body.error.code).toBe('ACCESS_TOKEN_EXPIRED');
    await request(server()).post(url('/auth/refresh')).set('Cookie', phone.cookie).expect(401);
    await request(server()).get(url('/auth/me')).set(bearer(laptop.token)).expect(200);
    expect(await list(laptop.token)).toHaveLength(1);
  });

  it('will not sign out this session from the list, nor someone else’s', async () => {
    const { laptop } = await twoDevices();
    const stranger = await twoDevices();
    const here = (await list(laptop.token)).find((session) => session.current);
    const theirs = (await list(stranger.laptop.token))[0];

    const self = await request(server())
      .delete(url(`/auth/sessions/${here?.id}`))
      .set(bearer(laptop.token))
      .expect(400);
    expect(self.body.error.code).toBe('SESSION_IS_CURRENT');

    await request(server())
      .delete(url(`/auth/sessions/${theirs?.id}`))
      .set(bearer(laptop.token))
      .expect(404);
    await request(server()).get(url('/auth/me')).set(bearer(stranger.laptop.token)).expect(200);
  });

  it('signs out every other session and keeps this one', async () => {
    const { laptop, phone } = await twoDevices();

    const response = await request(server())
      .post(url('/auth/sessions/revoke-others'))
      .set(bearer(laptop.token))
      .expect(200);
    expect(response.body.data).toEqual({ revoked: 1 });

    await request(server()).get(url('/auth/me')).set(bearer(phone.token)).expect(401);
    await request(server()).get(url('/auth/me')).set(bearer(laptop.token)).expect(200);
    await request(server()).post(url('/auth/refresh')).set('Cookie', laptop.cookie).expect(200);
  });

  it('stops this session’s access token at once after signing out everywhere', async () => {
    const { laptop } = await twoDevices();

    await request(server()).post(url('/auth/logout-all')).set(bearer(laptop.token)).expect(200);
    await request(server()).get(url('/auth/me')).set(bearer(laptop.token)).expect(401);
  });
});
