import { API_PREFIX, REFRESH_TOKEN_COOKIE } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Authentication (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;

  /** Pulls the refresh cookie out of a Set-Cookie header list. */
  const refreshCookie = (headers: request.Response['headers']): string => {
    const raw = headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw].filter(Boolean);
    const match = cookies.find((cookie) => String(cookie).startsWith(`${REFRESH_TOKEN_COOKIE}=`));

    if (!match) throw new Error('No refresh cookie was set.');
    return String(match).split(';')[0] as string;
  };

  const registerUser = async (email = uniqueEmail()) => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Test User', email, password: VALID_PASSWORD })
      .expect(201);

    return {
      email,
      accessToken: response.body.data.accessToken as string,
      cookie: refreshCookie(response.headers),
      body: response.body,
    };
  };

  describe('registration', () => {
    it('creates an account and returns a session', async () => {
      const email = uniqueEmail();
      const response = await request(server())
        .post(url('/auth/register'))
        .send({ name: 'Ada Lovelace', email, password: VALID_PASSWORD })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        meta: null,
        data: {
          user: { email, name: 'Ada Lovelace', emailVerified: false },
          expiresIn: 900,
        },
      });
      expect(response.body.data.accessToken).toEqual(expect.any(String));
    });

    it('never returns the password hash', async () => {
      const { body } = await registerUser();
      expect(JSON.stringify(body)).not.toMatch(/passwordHash|argon2/i);
    });

    it('sets an HTTP-only refresh cookie scoped to the auth routes', async () => {
      const email = uniqueEmail();
      const response = await request(server())
        .post(url('/auth/register'))
        .send({ name: 'Cookie Check', email, password: VALID_PASSWORD })
        .expect(201);

      const raw = response.headers['set-cookie'];
      const cookies = Array.isArray(raw) ? raw : [raw];
      const cookie = String(cookies.find((c) => String(c).startsWith(REFRESH_TOKEN_COOKIE)));

      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain(`Path=${API_PREFIX}/auth`);
      expect(cookie).toMatch(/SameSite=Lax/i);
    });

    it('stores the e-mail lower-cased and rejects a case-variant duplicate', async () => {
      const email = uniqueEmail();
      await request(server())
        .post(url('/auth/register'))
        .send({ name: 'First', email: email.toUpperCase(), password: VALID_PASSWORD })
        .expect(201);

      const duplicate = await request(server())
        .post(url('/auth/register'))
        .send({ name: 'Second', email, password: VALID_PASSWORD })
        .expect(409);

      expect(duplicate.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('rejects a weak password with field-level detail', async () => {
      const response = await request(server())
        .post(url('/auth/register'))
        .send({ name: 'Weak', email: uniqueEmail(), password: 'short' })
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
      expect(response.body.error.details.fields.length).toBeGreaterThan(0);
    });

    it('rejects unknown properties instead of silently ignoring them', async () => {
      const response = await request(server())
        .post(url('/auth/register'))
        .send({
          name: 'Sneaky',
          email: uniqueEmail(),
          password: VALID_PASSWORD,
          isAdmin: true,
        })
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('login', () => {
    it('returns a session for correct credentials', async () => {
      const { email } = await registerUser();

      const response = await request(server())
        .post(url('/auth/login'))
        .send({ email, password: VALID_PASSWORD })
        .expect(200);

      expect(response.body.data.user.email).toBe(email);
      expect(response.body.data.accessToken).toEqual(expect.any(String));
    });

    it('rejects a wrong password', async () => {
      const { email } = await registerUser();

      const response = await request(server())
        .post(url('/auth/login'))
        .send({ email, password: 'WrongPassword!9' })
        .expect(401);

      expect(response.body).toEqual({
        success: false,
        error: expect.objectContaining({ code: 'INVALID_CREDENTIALS' }),
      });
    });

    it('gives an unknown account the same error, so addresses cannot be enumerated', async () => {
      const response = await request(server())
        .post(url('/auth/login'))
        .send({ email: uniqueEmail('ghost'), password: 'WrongPassword!9' })
        .expect(401);

      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('refuses a disabled account', async () => {
      const { email } = await registerUser();
      await context.prisma.user.update({ where: { email }, data: { isActive: false } });

      const response = await request(server())
        .post(url('/auth/login'))
        .send({ email, password: VALID_PASSWORD })
        .expect(403);

      expect(response.body.error.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('GET /auth/me', () => {
    it('returns the authenticated user', async () => {
      const { email, accessToken } = await registerUser();

      const response = await request(server())
        .get(url('/auth/me'))
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data.email).toBe(email);
    });

    it('rejects a request with no token', async () => {
      const response = await request(server()).get(url('/auth/me')).expect(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('distinguishes a malformed token from a missing one', async () => {
      const response = await request(server())
        .get(url('/auth/me'))
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);

      expect(response.body.error.code).toBe('ACCESS_TOKEN_INVALID');
    });
  });

  describe('refresh-token rotation', () => {
    it('issues a new token pair and rotates the cookie', async () => {
      const { cookie } = await registerUser();

      const response = await request(server())
        .post(url('/auth/refresh'))
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body.data.accessToken).toEqual(expect.any(String));
      expect(refreshCookie(response.headers)).not.toBe(cookie);
    });

    it('supports a chain of consecutive rotations', async () => {
      const { cookie } = await registerUser();

      let current = cookie;
      for (let i = 0; i < 3; i += 1) {
        const response = await request(server())
          .post(url('/auth/refresh'))
          .set('Cookie', current)
          .expect(200);
        current = refreshCookie(response.headers);
      }

      expect(current).not.toBe(cookie);
    });

    it('rejects a request with no cookie', async () => {
      const response = await request(server()).post(url('/auth/refresh')).expect(401);
      expect(response.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('detects replay of an already-rotated token and revokes the whole family', async () => {
      const { cookie: original } = await registerUser();

      const rotated = await request(server())
        .post(url('/auth/refresh'))
        .set('Cookie', original)
        .expect(200);
      const currentCookie = refreshCookie(rotated.headers);

      // Presenting the superseded token is the signature of a stolen cookie.
      const replay = await request(server())
        .post(url('/auth/refresh'))
        .set('Cookie', original)
        .expect(401);
      expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');

      // The legitimate holder is logged out too — that is the point.
      await request(server()).post(url('/auth/refresh')).set('Cookie', currentCookie).expect(401);
    });

    it('persists only hashed refresh tokens', async () => {
      const { cookie } = await registerUser();
      const presented = cookie.split('=')[1] as string;

      const rows = await context.prisma.refreshToken.findMany();

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toHaveLength(64);
      expect(rows[0]?.tokenHash).not.toContain(presented);
    });
  });

  describe('logout', () => {
    it('revokes the session and clears the cookie', async () => {
      const { cookie } = await registerUser();

      const response = await request(server())
        .post(url('/auth/logout'))
        .set('Cookie', cookie)
        .expect(200);

      expect(response.body.data).toEqual({ loggedOut: true });

      await request(server()).post(url('/auth/refresh')).set('Cookie', cookie).expect(401);
    });

    it('is safe to call without a session', async () => {
      await request(server()).post(url('/auth/logout')).expect(200);
    });

    it('leaves other sessions of the same user alone', async () => {
      const { email, cookie: first } = await registerUser();

      const second = await request(server())
        .post(url('/auth/login'))
        .send({ email, password: VALID_PASSWORD })
        .expect(200);
      const secondCookie = refreshCookie(second.headers);

      await request(server()).post(url('/auth/logout')).set('Cookie', first).expect(200);

      // Logging out one device must not sign the user out everywhere.
      await request(server()).post(url('/auth/refresh')).set('Cookie', secondCookie).expect(200);
    });
  });
});
