import { API_PREFIX } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';
import type { PasswordResetEmailJobData } from '../../src/jobs/queue-names';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * "Forgot password". The e-mail itself is the worker's; here the queue is
 * watched instead, which is where the raw token is last seen in the clear.
 */
describe('Password reset (e2e)', () => {
  let context: TestContext;
  let sent: PasswordResetEmailJobData[];

  beforeAll(async () => {
    context = await createTestContext();
    jest
      .spyOn(context.app.get(EmailQueue), 'enqueuePasswordReset')
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

  const register = async () => {
    const email = uniqueEmail('reset');
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Ada Lovelace', email, password: VALID_PASSWORD })
      .expect(201);
    return { email, token: response.body.data.accessToken as string };
  };

  const forgot = (email: string) =>
    request(server()).post(url('/auth/forgot-password')).send({ email }).expect(202);

  it('e-mails a link, and the link sets a new password and signs out every session', async () => {
    const account = await register();

    await forgot(account.email.toUpperCase());
    expect(sent).toEqual([
      expect.objectContaining({
        email: account.email,
        name: 'Ada Lovelace',
        token: expect.any(String),
      }),
    ]);
    const token = sent[0]!.token;
    // Only the hash is stored.
    expect(await context.prisma.passwordResetToken.count({ where: { tokenHash: token } })).toBe(0);

    await request(server())
      .post(url('/auth/reset-password'))
      .send({ token, password: NEW_PASSWORD })
      .expect(204);

    // The old password no longer works; the new one does.
    await request(server())
      .post(url('/auth/login'))
      .send({ email: account.email, password: VALID_PASSWORD })
      .expect(401);
    await request(server())
      .post(url('/auth/login'))
      .send({ email: account.email, password: NEW_PASSWORD })
      .expect(200);

    // Every refresh token the account had is revoked.
    const live = await context.prisma.refreshToken.count({
      where: { user: { email: account.email }, revokedAt: null },
    });
    expect(live).toBe(1); // the sign-in just above

    // The link works once.
    const again = await request(server())
      .post(url('/auth/reset-password'))
      .send({ token, password: 'Another-pass-2026' })
      .expect(400);
    expect(again.body.error.code).toBe('PASSWORD_RESET_INVALID');
  });

  it('answers the same for an address with no account, and sends nothing', async () => {
    const response = await forgot('nobody-here@coretask.test');
    expect(response.body.data).toEqual({ sent: true });
    expect(sent).toEqual([]);
  });

  it('sends at most one link a minute, and a new link replaces an unused one', async () => {
    const account = await register();
    await forgot(account.email);
    await forgot(account.email);
    expect(sent).toHaveLength(1);

    // A minute later, a new link — and the first stops working.
    await context.prisma.passwordResetToken.updateMany({
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    await forgot(account.email);
    expect(sent).toHaveLength(2);
    await request(server())
      .post(url('/auth/reset-password'))
      .send({ token: sent[0]!.token, password: NEW_PASSWORD })
      .expect(400);
    await request(server())
      .post(url('/auth/reset-password'))
      .send({ token: sent[1]!.token, password: NEW_PASSWORD })
      .expect(204);
  });

  it('refuses an expired link and a weak password', async () => {
    const account = await register();
    await forgot(account.email);
    const token = sent[0]!.token;

    const weak = await request(server())
      .post(url('/auth/reset-password'))
      .send({ token, password: 'short' })
      .expect(422);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');

    await context.prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(0) } });
    await request(server())
      .post(url('/auth/reset-password'))
      .send({ token, password: NEW_PASSWORD })
      .expect(400);
  });
});
