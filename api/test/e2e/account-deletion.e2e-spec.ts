import { randomBytes } from 'node:crypto';

import { API_PREFIX, REFRESH_TOKEN_COOKIE, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import { isUndeliverableAddress } from '../../src/integrations/email/undeliverable-domains';
import { StorageService } from '../../src/integrations/storage/storage.service';
import { EmailQueue } from '../../src/jobs/email/email.queue';
import type { MessageEmailJobData } from '../../src/jobs/queue-names';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Deleting your own account: what it takes (workspaces only you were in,
 * everything personal), what it keeps (what you wrote in shared ones, under
 * "Deleted user"), and what stops it (shared workspaces you own).
 */
describe('Deleting an account (e2e)', () => {
  let context: TestContext;
  let storage: StorageService;
  let mail: MessageEmailJobData[];

  beforeAll(async () => {
    context = await createTestContext();
    storage = context.app.get(StorageService);
    jest.spyOn(context.app.get(EmailQueue), 'enqueueMessage').mockImplementation(async (data) => {
      mail.push(data);
    });
  });

  beforeEach(async () => {
    mail = [];
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
    email: string;
    cookie: string;
  }

  const register = async (name: string): Promise<Actor> => {
    const email = uniqueEmail('acctdel');
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email, password: VALID_PASSWORD })
      .expect(201);
    const userId = response.body.data.user.id as string;
    await context.prisma.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: new Date(), emailVerificationDueAt: null },
    });
    const raw = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw].filter(Boolean);
    const cookie = String(
      cookies.find((value) => String(value).startsWith(`${REFRESH_TOKEN_COOKIE}=`)),
    ).split(';')[0] as string;
    return { token: response.body.data.accessToken as string, userId, email, cookie };
  };

  const as = (actor: Actor) => ({
    get: (path: string) =>
      request(server()).get(url(path)).set('Authorization', `Bearer ${actor.token}`),
    post: (path: string, body: object = {}) =>
      request(server()).post(url(path)).set('Authorization', `Bearer ${actor.token}`).send(body),
    delete: (path: string, body: object = {}) =>
      request(server()).delete(url(path)).set('Authorization', `Bearer ${actor.token}`).send(body),
  });

  const createWorkspace = async (owner: Actor, name: string): Promise<string> =>
    (await as(owner).post('/workspaces', { name }).expect(201)).body.data.id as string;

  const addMember = (
    workspaceId: string,
    actor: Actor,
    role: WorkspaceRole = WorkspaceRole.MEMBER,
  ) => context.prisma.workspaceMember.create({ data: { workspaceId, userId: actor.userId, role } });

  const deleteAccount = (actor: Actor, body: object) => as(actor).delete('/users/me', body);

  describe('the preview', () => {
    it('sorts workspaces into deleted, blocking and left, and says what proof it will ask for', async () => {
      const ada = await register('Ada Lovelace');
      const bob = await register('Bob Builder');

      const alone = await createWorkspace(ada, 'Only Ada');
      const shared = await createWorkspace(ada, 'Ada and Bob');
      await addMember(shared, bob);
      const bobs = await createWorkspace(bob, 'Bob’s');
      await addMember(bobs, ada, WorkspaceRole.ADMIN);
      // An API key's account is not a person to hand a workspace to.
      await as(ada).post(`/workspaces/${alone}/api-keys`, { name: 'n8n' }).expect(201);

      const preview = await as(ada).get('/users/me/deletion').expect(200);

      expect(preview.body.data).toEqual({
        workspacesDeleted: [{ id: alone, name: 'Only Ada' }],
        workspacesBlocking: [{ id: shared, name: 'Ada and Bob', memberCount: 2 }],
        workspacesLeft: [{ id: bobs, name: 'Bob’s' }],
        reauth: 'password',
      });
    });

    it('asks an account with no password for a recent sign-in instead', async () => {
      const ada = await register('Ada Lovelace');
      await context.prisma.user.update({ where: { id: ada.userId }, data: { passwordHash: null } });

      const preview = await as(ada).get('/users/me/deletion').expect(200);
      expect(preview.body.data.reauth).toBe('recent-sign-in');
    });
  });

  describe('deleting', () => {
    it('deletes what was only theirs, leaves the rest, and keeps their history under "Deleted user"', async () => {
      const ada = await register('Ada Lovelace');
      const bob = await register('Bob Builder');

      // Only Ada's: goes with her.
      const alone = await createWorkspace(ada, 'Only Ada');
      const aloneProject = (
        await as(ada).post(`/workspaces/${alone}/projects`, { name: 'Notes' }).expect(201)
      ).body.data;
      await as(ada)
        .post(`/workspaces/${alone}/tasks`, {
          title: 'Mine',
          sectionId: aloneProject.sections[0].id,
        })
        .expect(201);

      // Bob's, which Ada is in: she leaves it, her history stays.
      const bobs = await createWorkspace(bob, 'Bob’s');
      await addMember(bobs, ada);
      const project = (
        await as(bob).post(`/workspaces/${bobs}/projects`, { name: 'Shared' }).expect(201)
      ).body.data;
      const sectionId = project.sections[0].id as string;
      // In the project, so Bob may give her its work.
      await context.prisma.projectMember.create({
        data: { projectId: project.id, userId: ada.userId, workspaceId: bobs, role: 'EDITOR' },
      });
      const open = (
        await as(bob)
          .post(`/workspaces/${bobs}/tasks`, { title: 'Open', sectionId, assigneeId: ada.userId })
          .expect(201)
      ).body.data;
      const done = (
        await as(bob)
          .post(`/workspaces/${bobs}/tasks`, {
            title: 'Done',
            sectionId,
            assigneeId: ada.userId,
            status: 'DONE',
          })
          .expect(201)
      ).body.data;
      await as(ada)
        .post(`/workspaces/${bobs}/tasks/${open.id}/comments`, { body: '<p>On it</p>' })
        .expect(201);
      const team = await context.prisma.team.create({
        data: { workspaceId: bobs, name: 'Crew', leadId: ada.userId },
      });
      await context.prisma.teamMember.create({ data: { teamId: team.id, userId: ada.userId } });

      // A picture, really uploaded.
      const bytes = Buffer.from('a picture'.padEnd(256, '.'));
      const declared = await as(ada)
        .post('/users/me/avatar', { mimeType: 'image/png', sizeBytes: bytes.length })
        .expect(201);
      await fetch(declared.body.data.uploadUrl, {
        method: 'PUT',
        headers: declared.body.data.headers,
        body: bytes,
      });
      await as(ada)
        .post('/users/me/avatar/confirm', { uploadToken: declared.body.data.uploadToken })
        .expect(200);
      const avatarKey = (await context.prisma.user.findUniqueOrThrow({ where: { id: ada.userId } }))
        .avatarKey as string;

      // Things only Ada had.
      const db = context.prisma;
      await db.userIdentity.create({
        data: { userId: ada.userId, provider: 'GOOGLE', subject: 'g-123', email: ada.email },
      });
      await db.savedSearch.create({
        data: { workspaceId: bobs, userId: ada.userId, name: 'Mine' },
      });
      await db.calendarFeed.create({
        data: { workspaceId: bobs, userId: ada.userId, token: randomBytes(16).toString('hex') },
      });
      await db.notificationPreference.create({ data: { workspaceId: bobs, userId: ada.userId } });
      await db.notification.create({
        data: { userId: ada.userId, workspaceId: bobs, type: 'TASK_ASSIGNED', title: 'Yours' },
      });
      await db.projectView.create({
        data: {
          workspaceId: bobs,
          projectId: project.id,
          name: 'My view',
          type: 'LIST',
          scope: 'PERSONAL',
          ownerUserId: ada.userId,
        },
      });
      await db.oAuthApp.create({
        data: {
          ownerId: ada.userId,
          name: 'Ada’s app',
          clientId: `cta_${randomBytes(8).toString('hex')}`,
        },
      });

      await deleteAccount(ada, { confirmation: 'DELETE', password: VALID_PASSWORD })
        .expect(204)
        .expect((response) => {
          expect(String(response.headers['set-cookie'])).toMatch(
            new RegExp(`${REFRESH_TOKEN_COOKIE}=;`),
          );
        });

      // Her own workspace is gone; Bob's is not, and she is out of it.
      expect(await db.workspace.count({ where: { id: alone } })).toBe(0);
      expect(await db.workspace.count({ where: { id: bobs } })).toBe(1);
      expect(await db.workspaceMember.count({ where: { userId: ada.userId } })).toBe(0);
      expect(await db.teamMember.count({ where: { userId: ada.userId } })).toBe(0);
      expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).leadId).toBeNull();

      // Open work is unassigned; finished work still says who did it.
      expect((await db.task.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBeNull();
      const finished = await as(bob).get(`/workspaces/${bobs}/tasks/${done.id}`).expect(200);
      expect(finished.body.data.assignee).toMatchObject({ id: ada.userId, name: 'Deleted user' });

      // Her comment stays, by "Deleted user", with no picture.
      const comments = await as(bob)
        .get(`/workspaces/${bobs}/tasks/${open.id}/comments`)
        .expect(200);
      expect(comments.body.data[0].author).toMatchObject({
        id: ada.userId,
        name: 'Deleted user',
        avatarUrl: null,
      });

      // The row, scrubbed.
      const row = await db.user.findUniqueOrThrow({ where: { id: ada.userId } });
      expect(row).toMatchObject({
        email: `deleted+${ada.userId}@deleted.coretask.invalid`,
        name: 'Deleted user',
        passwordHash: null,
        avatarUrl: null,
        avatarKey: null,
        totpSecret: null,
        emailVerifiedAt: null,
        isActive: false,
      });
      expect(row.deletedAt).toBeInstanceOf(Date);
      expect(isUndeliverableAddress(row.email)).toBe(true);
      expect(await storage.headObject(avatarKey)).toBeNull();

      // Everything personal, gone.
      const where = { where: { userId: ada.userId } };
      expect(await db.refreshToken.count(where)).toBe(0);
      expect(await db.userIdentity.count(where)).toBe(0);
      expect(await db.savedSearch.count(where)).toBe(0);
      expect(await db.calendarFeed.count(where)).toBe(0);
      expect(await db.notificationPreference.count(where)).toBe(0);
      expect(await db.notification.count(where)).toBe(0);
      expect(await db.projectView.count({ where: { ownerUserId: ada.userId } })).toBe(0);
      expect(await db.oAuthApp.count({ where: { ownerId: ada.userId } })).toBe(0);

      // Signed out everywhere, and the old address no longer signs in.
      await as(ada).get('/auth/me').expect(401);
      await request(server()).post(url('/auth/refresh')).set('Cookie', ada.cookie).expect(401);
      await request(server())
        .post(url('/auth/login'))
        .send({ email: ada.email, password: VALID_PASSWORD })
        .expect(401);

      // A last note to the address she had, with no link back into an account.
      // (The rest of `mail` is Bob's assignments, sent while setting up.)
      const notices = mail.filter((message) => message.subject.includes('account was deleted'));
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        to: ada.email,
        subject: 'Your CoreTask account was deleted',
      });
      expect(notices[0]?.text).not.toContain('/settings');

      // And the address is free to sign up with again — a new account.
      const again = await request(server())
        .post(url('/auth/register'))
        .send({ name: 'Ada Again', email: ada.email, password: VALID_PASSWORD })
        .expect(201);
      expect(again.body.data.user.id).not.toBe(ada.userId);
    });

    it('lets an account with no password delete itself within minutes of signing in, not later', async () => {
      const ada = await register('Ada Lovelace');
      await context.prisma.user.update({ where: { id: ada.userId }, data: { passwordHash: null } });
      await context.prisma.refreshToken.updateMany({
        where: { userId: ada.userId },
        data: { sessionStartedAt: new Date(Date.now() - 60 * 60_000) },
      });

      const stale = await deleteAccount(ada, { confirmation: 'DELETE' }).expect(403);
      expect(stale.body.error.code).toBe('RECENT_SIGN_IN_REQUIRED');

      await context.prisma.refreshToken.updateMany({
        where: { userId: ada.userId },
        data: { sessionStartedAt: new Date() },
      });
      await deleteAccount(ada, { confirmation: 'DELETE' }).expect(204);
      expect(
        (await context.prisma.user.findUniqueOrThrow({ where: { id: ada.userId } })).deletedAt,
      ).not.toBeNull();
    });
  });

  describe('refusals', () => {
    const untouched = async (actor: Actor) => {
      const row = await context.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
      expect(row).toMatchObject({ email: actor.email, deletedAt: null, isActive: true });
      await as(actor).get('/auth/me').expect(200);
    };

    it('refuses while it owns a workspace other people are in, and says which', async () => {
      const ada = await register('Ada Lovelace');
      const bob = await register('Bob Builder');
      const alone = await createWorkspace(ada, 'Only Ada');
      const shared = await createWorkspace(ada, 'Ada and Bob');
      await addMember(shared, bob);

      const response = await deleteAccount(ada, {
        confirmation: 'DELETE',
        password: VALID_PASSWORD,
      }).expect(409);

      expect(response.body.error.code).toBe('ACCOUNT_OWNS_SHARED_WORKSPACES');
      expect(response.body.error.details.workspaces).toEqual([
        { id: shared, name: 'Ada and Bob', memberCount: 2 },
      ]);
      // Nothing went, not even the workspace only Ada was in.
      expect(await context.prisma.workspace.count({ where: { id: alone } })).toBe(1);
      await untouched(ada);
    });

    it('refuses anything but DELETE typed back, before checking the password', async () => {
      const ada = await register('Ada Lovelace');

      for (const confirmation of ['delete', 'DELETE ', 'yes']) {
        const response = await deleteAccount(ada, { confirmation, password: 'wrong' }).expect(400);
        expect(response.body.error.code).toBe('CONFIRMATION_MISMATCH');
      }
      await deleteAccount(ada, { password: VALID_PASSWORD }).expect(422);
      await untouched(ada);
    });

    it('refuses a wrong password, or none', async () => {
      const ada = await register('Ada Lovelace');

      const wrong = await deleteAccount(ada, {
        confirmation: 'DELETE',
        password: 'not-the-password',
      }).expect(400);
      expect(wrong.body.error.code).toBe('CURRENT_PASSWORD_INCORRECT');

      const none = await deleteAccount(ada, { confirmation: 'DELETE' }).expect(400);
      expect(none.body.error.code).toBe('REAUTH_REQUIRED');
      await untouched(ada);
    });

    it('never takes an API key', async () => {
      const ada = await register('Ada Lovelace');
      const workspaceId = await createWorkspace(ada, 'Only Ada');
      const key = (
        await as(ada).post(`/workspaces/${workspaceId}/api-keys`, { name: 'n8n' }).expect(201)
      ).body.data;

      await request(server())
        .delete(url('/users/me'))
        .set('X-API-Key', key.secret as string)
        .send({ confirmation: 'DELETE', password: VALID_PASSWORD })
        .expect(403);
      await request(server())
        .get(url('/users/me/deletion'))
        .set('X-API-Key', key.secret as string)
        .expect(403);
      await untouched(ada);
    });
  });
});
