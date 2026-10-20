import { API_PREFIX } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';
import type { EmailChangeJobData, MessageEmailJobData } from '../../src/jobs/queue-names';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Moving an account to a new address: asked for with the password, finished
 * by the link sent to the new inbox, announced to the old one. The links go
 * through the queue, which is watched here — the last place the raw token is.
 */
describe('Changing the e-mail address (e2e)', () => {
  let context: TestContext;
  let links: EmailChangeJobData[];
  let notices: MessageEmailJobData[];

  beforeAll(async () => {
    context = await createTestContext();
    const queue = context.app.get(EmailQueue);
    jest.spyOn(queue, 'enqueueEmailVerification').mockResolvedValue(undefined);
    jest.spyOn(queue, 'enqueuePasswordReset').mockResolvedValue(undefined);
    jest.spyOn(queue, 'enqueueEmailChange').mockImplementation(async (data) => {
      links.push(data);
    });
    jest.spyOn(queue, 'enqueueMessage').mockImplementation(async (data) => {
      notices.push(data);
    });
  });

  beforeEach(async () => {
    links = [];
    notices = [];
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const register = async (email = uniqueEmail('mover')) => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Ada Lovelace', email, password: VALID_PASSWORD })
      .expect(201);
    return { email, token: response.body.data.accessToken as string };
  };

  const ask = (token: string, body: object) =>
    request(server()).post(url('/auth/email-change')).set(bearer(token)).send(body);

  const confirm = (token: string) =>
    request(server()).post(url('/auth/email-change/confirm')).send({ token });

  it('moves the account once the link sent to the new address is used', async () => {
    const account = await register();
    const next = uniqueEmail('moved');

    const asked = await ask(account.token, {
      email: next.toUpperCase(),
      password: VALID_PASSWORD,
    }).expect(202);
    expect(asked.body.data.email).toBe(next);
    expect(links).toHaveLength(1);
    expect(links[0]?.email).toBe(next);
    // The old address hears about it before anything has changed.
    expect(notices[0]?.to).toBe(account.email);

    const pending = await request(server())
      .get(url('/auth/email-change'))
      .set(bearer(account.token))
      .expect(200);
    expect(pending.body.data.email).toBe(next);

    // Nothing has moved yet.
    await request(server())
      .post(url('/auth/login'))
      .send({ email: account.email, password: VALID_PASSWORD })
      .expect(200);

    const done = await confirm(links[0]?.token as string).expect(200);
    expect(done.body.data).toEqual({ email: next });

    const me = await request(server()).get(url('/auth/me')).set(bearer(account.token)).expect(200);
    expect(me.body.data).toMatchObject({ email: next, emailVerified: true });
    await request(server())
      .post(url('/auth/login'))
      .send({ email: account.email, password: VALID_PASSWORD })
      .expect(401);
    await request(server())
      .post(url('/auth/login'))
      .send({ email: next, password: VALID_PASSWORD })
      .expect(200);

    // And the old address is told it is done.
    expect(notices.at(-1)).toMatchObject({
      to: account.email,
      subject: 'Your CoreTask e-mail address was changed',
    });
    await confirm(links[0]?.token as string).expect(400);
  });

  it('needs the password, a different address, and one nobody else has', async () => {
    const account = await register();
    const other = await register();

    expect((await ask(account.token, { email: uniqueEmail() }).expect(400)).body.error.code).toBe(
      'REAUTH_REQUIRED',
    );
    expect(
      (await ask(account.token, { email: uniqueEmail(), password: 'Wrong-pass-2026' }).expect(400))
        .body.error.code,
    ).toBe('CURRENT_PASSWORD_INCORRECT');
    await ask(account.token, { email: account.email, password: VALID_PASSWORD }).expect(400);
    expect(
      (await ask(account.token, { email: other.email, password: VALID_PASSWORD }).expect(409)).body
        .error.code,
    ).toBe('EMAIL_ALREADY_REGISTERED');
    expect(links).toHaveLength(0);
  });

  it('sends at most one link a minute, and a new request replaces the old link', async () => {
    const account = await register();
    await ask(account.token, { email: uniqueEmail(), password: VALID_PASSWORD }).expect(202);
    await ask(account.token, { email: uniqueEmail(), password: VALID_PASSWORD }).expect(429);

    await context.prisma.emailChangeToken.updateMany({
      data: { createdAt: new Date(Date.now() - 120_000) },
    });
    await ask(account.token, { email: uniqueEmail(), password: VALID_PASSWORD }).expect(202);

    await confirm(links[0]?.token as string).expect(400);
    await confirm(links[1]?.token as string).expect(200);
  });

  it('cancels a waiting change', async () => {
    const account = await register();
    await ask(account.token, { email: uniqueEmail(), password: VALID_PASSWORD }).expect(202);

    await request(server())
      .delete(url('/auth/email-change'))
      .set(bearer(account.token))
      .expect(204);
    const pending = await request(server())
      .get(url('/auth/email-change'))
      .set(bearer(account.token))
      .expect(200);
    expect(pending.body.data).toBeNull();
    await confirm(links[0]?.token as string).expect(400);
  });

  it('refuses the link when the address was taken in the meantime', async () => {
    const account = await register();
    const next = uniqueEmail('contested');
    await ask(account.token, { email: next, password: VALID_PASSWORD }).expect(202);
    await register(next);

    const response = await confirm(links[0]?.token as string).expect(409);
    expect(response.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('kills reset links mailed to the old address', async () => {
    const account = await register();
    await request(server()).post(url('/auth/forgot-password')).send({ email: account.email });
    expect(await context.prisma.passwordResetToken.count()).toBe(1);

    await ask(account.token, { email: uniqueEmail(), password: VALID_PASSWORD }).expect(202);
    await confirm(links[0]?.token as string).expect(200);
    expect(await context.prisma.passwordResetToken.count()).toBe(0);
  });
});
