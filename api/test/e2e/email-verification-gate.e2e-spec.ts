import { createHash } from 'node:crypto';

import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';
import type { EmailVerificationJobData } from '../../src/jobs/queue-names';

import {
  closeTestContext,
  confirmEmail,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * What an unconfirmed address may and may not do: inviting people and
 * connecting integrations wait for it from the start; everything else waits
 * only once the deadline has passed, and then the routes that fix it stay open.
 */
describe('Confirming the e-mail address is required (e2e)', () => {
  let context: TestContext;
  let links: EmailVerificationJobData[];

  beforeAll(async () => {
    context = await createTestContext();
    const queue = context.app.get(EmailQueue);
    jest.spyOn(queue, 'enqueueEmailVerification').mockImplementation(async (data) => {
      links.push(data);
    });
    jest.spyOn(queue, 'enqueueInvitation').mockResolvedValue(undefined);
  });

  beforeEach(async () => {
    links = [];
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  const register = async (email = uniqueEmail('unconfirmed')) => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Ada Lovelace', email, password: VALID_PASSWORD })
      .expect(201);
    return {
      email,
      userId: response.body.data.user.id as string,
      token: response.body.data.accessToken as string,
      user: response.body.data.user as { emailVerificationDueAt: string | null },
    };
  };

  const createWorkspace = async (token: string) =>
    (
      await request(server())
        .post(url('/workspaces'))
        .set(bearer(token))
        .send({ name: 'Acme Product' })
        .expect(201)
    ).body.data.id as string;

  const overdue = (userId: string) =>
    context.prisma.user.update({
      where: { id: userId },
      data: { emailVerificationDueAt: new Date(Date.now() - 60_000) },
    });

  it('gives a new account a week to confirm', async () => {
    const account = await register();
    const due = Date.parse(account.user.emailVerificationDueAt as string);
    expect(due - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    expect(due - Date.now()).toBeLessThan(7.1 * 86_400_000);
  });

  it('holds inviting people and creating API keys until the address is confirmed', async () => {
    const account = await register();
    const workspaceId = await createWorkspace(account.token);

    const invite = () =>
      request(server())
        .post(url(`/workspaces/${workspaceId}/invitations`))
        .set(bearer(account.token))
        .send({ email: uniqueEmail('invitee'), role: WorkspaceRole.MEMBER });
    const apiKey = () =>
      request(server())
        .post(url(`/workspaces/${workspaceId}/api-keys`))
        .set(bearer(account.token))
        .send({ name: 'n8n', role: WorkspaceRole.MEMBER });

    expect((await invite().expect(403)).body.error.code).toBe('EMAIL_NOT_VERIFIED');
    expect((await apiKey().expect(403)).body.error.code).toBe('EMAIL_NOT_VERIFIED');

    await confirmEmail(context, account.userId);
    await invite().expect(201);
    await apiKey().expect(201);
  });

  it('closes everything but the way out once the deadline has passed', async () => {
    const account = await register();
    await createWorkspace(account.token);
    await overdue(account.userId);

    const refused = await request(server()).get(url('/workspaces')).set(bearer(account.token));
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    // The routes that confirm, change or resend the address, and sign out.
    await request(server()).get(url('/auth/me')).set(bearer(account.token)).expect(200);
    await request(server()).get(url('/auth/sessions')).set(bearer(account.token)).expect(200);
    await request(server()).get(url('/auth/email-change')).set(bearer(account.token)).expect(200);
    await request(server())
      .post(url('/auth/resend-verification'))
      .set(bearer(account.token))
      .expect(200);

    await request(server())
      .post(url('/auth/verify-email'))
      .send({ token: links.at(-1)?.token })
      .expect(200);
    await request(server()).get(url('/workspaces')).set(bearer(account.token)).expect(200);
    const me = await request(server()).get(url('/auth/me')).set(bearer(account.token));
    expect(me.body.data).toMatchObject({ emailVerified: true, emailVerificationDueAt: null });
  });

  it('counts accepting an invitation as confirming the address', async () => {
    const owner = await register(uniqueEmail('owner'));
    await confirmEmail(context, owner.userId);
    const workspaceId = await createWorkspace(owner.token);
    const inviteeEmail = uniqueEmail('invitee');
    const invitation = await request(server())
      .post(url(`/workspaces/${workspaceId}/invitations`))
      .set(bearer(owner.token))
      .send({ email: inviteeEmail, role: WorkspaceRole.MEMBER })
      .expect(201);
    await context.prisma.workspaceInvitation.update({
      where: { id: invitation.body.data.id },
      data: { tokenHash: createHash('sha256').update('known-token').digest('hex') },
    });

    const invitee = await register(inviteeEmail);
    await request(server())
      .post(url('/invitations/known-token/accept'))
      .set(bearer(invitee.token))
      .expect(200);

    const me = await request(server()).get(url('/auth/me')).set(bearer(invitee.token));
    expect(me.body.data).toMatchObject({ emailVerified: true, emailVerificationDueAt: null });
  });
});
