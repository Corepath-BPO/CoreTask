import { API_PREFIX, REFRESH_TOKEN_COOKIE } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';
import type { EmailVerificationJobData } from '../../src/jobs/queue-names';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Signing out everywhere, changing a password from inside a session, and
 * confirming an e-mail address. The confirmation e-mail is the worker's; the
 * queue is watched instead, which is where the raw token is last seen.
 */
describe('Account security (e2e)', () => {
  let context: TestContext;
  let sent: EmailVerificationJobData[];

  beforeAll(async () => {
    context = await createTestContext();
    jest
      .spyOn(context.app.get(EmailQueue), 'enqueueEmailVerification')
      .mockImplementation(async (data) => {
        sent.push(data);
      });
  });

  beforeEach(async () => {
    sent = [];
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;
  const NEW_PASSWORD = 'Brand-new-pass-2026';

  const refreshCookie = (headers: request.Response['headers']): string => {
    const raw = headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw].filter(Boolean);
    const match = cookies.find((cookie) => String(cookie).startsWith(`${REFRESH_TOKEN_COOKIE}=`));
    if (!match) throw new Error('No refresh cookie was set.');
    return String(match).split(';')[0] as string;
  };

  /** Registers, then signs in again, so the account has two sessions. */
  const twoSessions = async () => {
    const email = uniqueEmail('security');
    const first = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Grace Hopper', email, password: VALID_PASSWORD })
      .expect(201);
    const second = await request(server())
      .post(url('/auth/login'))
      .send({ email, password: VALID_PASSWORD })
      .expect(200);

    return {
      email,
      here: {
        token: first.body.data.accessToken as string,
        cookie: refreshCookie(first.headers),
      },
      elsewhere: {
        token: second.body.data.accessToken as string,
        cookie: refreshCookie(second.headers),
      },
    };
  };

  const refresh = (cookie: string) =>
    request(server()).post(url('/auth/refresh')).set('Cookie', cookie);

  describe('sign out everywhere', () => {
    it('revokes every session, this one included, and clears the cookie', async () => {
      const account = await twoSessions();

      const response = await request(server())
        .post(url('/auth/logout-all'))
        .set('Authorization', `Bearer ${account.here.token}`)
        .expect(200);

      expect(response.body.data).toEqual({ loggedOut: true });
      expect(String(response.headers['set-cookie'])).toMatch(
        new RegExp(`${REFRESH_TOKEN_COOKIE}=;`),
      );
      await refresh(account.here.cookie).expect(401);
      await refresh(account.elsewhere.cookie).expect(401);
      expect(
        await context.prisma.refreshToken.count({
          where: { user: { email: account.email }, revokedAt: null },
        }),
      ).toBe(0);
    });

    it('needs a signed-in person', async () => {
      await request(server()).post(url('/auth/logout-all')).expect(401);
    });
  });

  describe('change password', () => {
    const change = (token: string, body: object) =>
      request(server())
        .post(url('/auth/change-password'))
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    it('keeps this session, signs out the others, and swaps the password', async () => {
      const account = await twoSessions();

      await change(account.here.token, {
        currentPassword: VALID_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);

      await refresh(account.here.cookie).expect(200);
      await refresh(account.elsewhere.cookie).expect(401);

      await request(server())
        .post(url('/auth/login'))
        .send({ email: account.email, password: VALID_PASSWORD })
        .expect(401);
      await request(server())
        .post(url('/auth/login'))
        .send({ email: account.email, password: NEW_PASSWORD })
        .expect(200);
    });

    it('refuses a wrong current password with a 400, leaving everything as it was', async () => {
      const account = await twoSessions();

      const response = await change(account.here.token, {
        currentPassword: 'not-the-password',
        newPassword: NEW_PASSWORD,
      }).expect(400);

      expect(response.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');
      await refresh(account.elsewhere.cookie).expect(200);
      await request(server())
        .post(url('/auth/login'))
        .send({ email: account.email, password: VALID_PASSWORD })
        .expect(200);
    });

    it('holds the new password to the policy and refuses the current one again', async () => {
      const account = await twoSessions();

      await change(account.here.token, {
        currentPassword: VALID_PASSWORD,
        newPassword: 'short',
      }).expect(422);
      await change(account.here.token, {
        currentPassword: VALID_PASSWORD,
        newPassword: VALID_PASSWORD,
      }).expect(422);
    });

    it('voids a reset link asked for before the change', async () => {
      const account = await twoSessions();
      jest.spyOn(context.app.get(EmailQueue), 'enqueuePasswordReset').mockResolvedValue();
      await request(server())
        .post(url('/auth/forgot-password'))
        .send({ email: account.email })
        .expect(202);
      expect(await context.prisma.passwordResetToken.count()).toBe(1);

      await change(account.here.token, {
        currentPassword: VALID_PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);

      expect(await context.prisma.passwordResetToken.count()).toBe(0);
    });
  });

  describe('e-mail confirmation', () => {
    const me = (token: string) =>
      request(server()).get(url('/auth/me')).set('Authorization', `Bearer ${token}`).expect(200);
    const resend = (token: string) =>
      request(server())
        .post(url('/auth/resend-verification'))
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    const verify = (token: string) =>
      request(server()).post(url('/auth/verify-email')).send({ token });

    /** Ages every link past the resend window, as if a minute had gone by. */
    const ageLinks = () =>
      context.prisma.emailVerificationToken.updateMany({
        data: { createdAt: new Date(Date.now() - 120_000) },
      });

    it('sends the link on sign-up as the welcome, and the link confirms the address', async () => {
      const account = await twoSessions();

      expect(sent).toEqual([
        expect.objectContaining({ email: account.email, name: 'Grace Hopper', welcome: true }),
      ]);
      const token = sent[0]!.token;
      // Only the hash is stored.
      expect(
        await context.prisma.emailVerificationToken.count({ where: { tokenHash: token } }),
      ).toBe(0);
      expect((await me(account.here.token)).body.data.emailVerified).toBe(false);

      const response = await verify(token).expect(200);
      expect(response.body.data).toEqual({ email: account.email });
      expect((await me(account.here.token)).body.data.emailVerified).toBe(true);

      // The link works once.
      const again = await verify(token).expect(400);
      expect(again.body.error.code).toBe('EMAIL_VERIFICATION_INVALID');
    });

    it('resends at most once a minute, and a new link replaces the old one', async () => {
      const account = await twoSessions();
      const first = sent[0]!.token;

      expect((await resend(account.here.token)).body.data).toEqual({
        sent: false,
        emailVerified: false,
      });
      expect(sent).toHaveLength(1);

      await ageLinks();
      expect((await resend(account.here.token)).body.data).toEqual({
        sent: true,
        emailVerified: false,
      });
      expect(sent).toHaveLength(2);
      expect(sent[1]).toEqual(expect.objectContaining({ welcome: false }));

      await verify(first).expect(400);
      await verify(sent[1]!.token).expect(200);

      await ageLinks();
      expect((await resend(account.here.token)).body.data).toEqual({
        sent: false,
        emailVerified: true,
      });
    });

    it('refuses a link sent to an address the account no longer has', async () => {
      const account = await twoSessions();
      await context.prisma.user.update({
        where: { email: account.email },
        data: { email: uniqueEmail('moved') },
      });

      await verify(sent[0]!.token).expect(400);
    });

    it('refuses an expired link', async () => {
      await twoSessions();
      await context.prisma.emailVerificationToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await verify(sent[0]!.token).expect(400);
    });

    it('counts a used reset link as proof of the address', async () => {
      const account = await twoSessions();
      const resets: string[] = [];
      jest
        .spyOn(context.app.get(EmailQueue), 'enqueuePasswordReset')
        .mockImplementation(async (data) => {
          resets.push(data.token);
        });
      await request(server())
        .post(url('/auth/forgot-password'))
        .send({ email: account.email })
        .expect(202);

      await request(server())
        .post(url('/auth/reset-password'))
        .send({ token: resets[0], password: NEW_PASSWORD })
        .expect(204);

      const user = await context.prisma.user.findUniqueOrThrow({ where: { email: account.email } });
      expect(user.emailVerifiedAt).not.toBeNull();
    });
  });
});
