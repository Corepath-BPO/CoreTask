import { randomUUID } from 'node:crypto';

import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Status updates, messages and files: who may post, who hears about it, and
 * that a private project's conversation stays private.
 */
describe('Project updates (e2e)', () => {
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

  interface Actor {
    token: string;
    userId: string;
  }

  const registerUser = async (name: string): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  const setup = async () => {
    const owner = await registerUser('Ada Owner');
    const member = await registerUser('Bea Member');
    const guest = await registerUser('Cy Guest');
    const outsider = await registerUser('Dee Outsider');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    await context.prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
        { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
        { workspaceId, userId: outsider.userId, role: WorkspaceRole.MEMBER },
      ],
    });

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(as(owner))
      .send({ name: 'Leasing', visibility: 'PRIVATE' })
      .expect(201);
    const projectId = project.body.data.id as string;

    for (const actor of [member, guest]) {
      await request(server())
        .post(url(`/workspaces/${workspaceId}/projects/${projectId}/members`))
        .set(as(owner))
        .send({ userId: actor.userId })
        .expect(201);
    }

    return { owner, member, guest, outsider, workspaceId, projectId };
  };

  const projectUrl = (scope: { workspaceId: string; projectId: string }, path = '') =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}${path}`);

  const notificationsFor = (userId: string) =>
    context.prisma.notification.findMany({ where: { userId, type: 'PROJECT_UPDATE' } });

  describe('status updates', () => {
    it('becomes the project’s status, and tells the members but not the author', async () => {
      const scope = await setup();

      await request(server())
        .post(projectUrl(scope, '/status-updates'))
        .set(as(scope.member))
        .send({ status: 'AT_RISK', title: 'Leasing — week 41', summary: 'Two renewals slipped.' })
        .expect(201);
      const latest = await request(server())
        .post(projectUrl(scope, '/status-updates'))
        .set(as(scope.member))
        .send({ status: 'ON_TRACK', title: 'Leasing — week 42', nextSteps: 'Send the notices.' })
        .expect(201);

      const current = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/status-updates/latest`))
        .set(as(scope.owner))
        .expect(200);
      expect(current.body.data).toEqual([
        expect.objectContaining({
          id: latest.body.data.id,
          projectId: scope.projectId,
          status: 'ON_TRACK',
          nextSteps: 'Send the notices.',
          author: expect.objectContaining({ name: 'Bea Member' }),
        }),
      ]);

      const history = await request(server())
        .get(projectUrl(scope, '/status-updates'))
        .set(as(scope.guest))
        .expect(200);
      expect(history.body.data.map((row: { status: string }) => row.status)).toEqual([
        'ON_TRACK',
        'AT_RISK',
      ]);

      expect(await notificationsFor(scope.owner.userId)).toHaveLength(2);
      expect(await notificationsFor(scope.member.userId)).toHaveLength(0);
    });

    it('lets a guest read but not post, and hides a private project from outsiders', async () => {
      const scope = await setup();

      await request(server())
        .post(projectUrl(scope, '/status-updates'))
        .set(as(scope.guest))
        .send({ status: 'ON_TRACK', title: 'Not mine to say' })
        .expect(403);

      await request(server())
        .post(projectUrl(scope, '/status-updates'))
        .set(as(scope.owner))
        .send({ status: 'ON_HOLD', title: 'Paused' })
        .expect(201);

      await request(server())
        .get(projectUrl(scope, '/status-updates'))
        .set(as(scope.outsider))
        .expect(404);
      const latest = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/status-updates/latest`))
        .set(as(scope.outsider))
        .expect(200);
      expect(latest.body.data).toEqual([]);
    });

    it('is deleted by its author or a manager, not by another member', async () => {
      const scope = await setup();
      const posted = await request(server())
        .post(projectUrl(scope, '/status-updates'))
        .set(as(scope.owner))
        .send({ status: 'OFF_TRACK', title: 'Wrong project' })
        .expect(201);
      const path = `/status-updates/${posted.body.data.id as string}`;

      await request(server()).delete(projectUrl(scope, path)).set(as(scope.member)).expect(403);
      await request(server()).delete(projectUrl(scope, path)).set(as(scope.owner)).expect(204);
    });

    it('refuses a status that does not exist', async () => {
      const scope = await setup();
      await request(server())
        .post(projectUrl(scope, '/status-updates'))
        .set(as(scope.owner))
        .send({ status: 'VIBES', title: 'Hmm' })
        // Validation failures are 422 across this API.
        .expect(422);
    });
  });

  describe('messages', () => {
    it('posts a message, sanitises it, and tells the conversation about a reply', async () => {
      const scope = await setup();

      const posted = await request(server())
        .post(projectUrl(scope, '/messages'))
        .set(as(scope.owner))
        .send({ title: 'Kick-off', body: '<p>Agenda</p><script>alert(1)</script>' })
        .expect(201);
      const messageId = posted.body.data.id as string;
      expect(posted.body.data.body).not.toContain('<script>');

      // The project heard about the message; the author did not.
      expect(await notificationsFor(scope.member.userId)).toHaveLength(1);
      expect(await notificationsFor(scope.owner.userId)).toHaveLength(0);

      const replied = await request(server())
        .post(projectUrl(scope, `/messages/${messageId}/replies`))
        .set(as(scope.member))
        .send({ body: 'Sounds good' })
        .expect(201);
      expect(replied.body.data.replies).toEqual([
        expect.objectContaining({ author: expect.objectContaining({ name: 'Bea Member' }) }),
      ]);

      // The reply goes to the message's author, not to the whole project again.
      expect(await notificationsFor(scope.owner.userId)).toHaveLength(1);
      expect(await notificationsFor(scope.guest.userId)).toHaveLength(1);

      const listed = await request(server())
        .get(projectUrl(scope, '/messages'))
        .set(as(scope.guest))
        .expect(200);
      expect(listed.body.data).toHaveLength(1);

      await request(server())
        .post(projectUrl(scope, `/messages/${messageId}/replies`))
        .set(as(scope.guest))
        .send({ body: 'Guests cannot reply' })
        .expect(403);
      await request(server())
        .delete(projectUrl(scope, `/messages/${messageId}`))
        .set(as(scope.member))
        .expect(403);
      await request(server())
        .delete(projectUrl(scope, `/messages/${messageId}`))
        .set(as(scope.owner))
        .expect(204);
    });

    it('404s a message in another project', async () => {
      const scope = await setup();
      await request(server())
        .post(projectUrl(scope, `/messages/${randomUUID()}/replies`))
        .set(as(scope.owner))
        .send({ body: 'Anyone?' })
        .expect(404);
    });
  });

  describe('files', () => {
    it('lists finished uploads on the project’s tasks, with the task they are on', async () => {
      const scope = await setup();
      const task = await context.prisma.task.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          title: 'Lease scan',
          createdById: scope.owner.userId,
        },
      });
      const file = (status: 'READY' | 'PENDING', filename: string) =>
        context.prisma.attachment.create({
          data: {
            workspaceId: scope.workspaceId,
            uploaderId: scope.owner.userId,
            taskId: task.id,
            filename,
            mimeType: 'application/pdf',
            sizeBytes: 2048,
            objectKey: `test/${randomUUID()}`,
            status,
          },
        });
      await file('READY', 'lease.pdf');
      await file('PENDING', 'half-uploaded.pdf');

      const listed = await request(server())
        .get(projectUrl(scope, '/files'))
        .set(as(scope.guest))
        .expect(200);
      expect(listed.body.data).toEqual([
        expect.objectContaining({
          filename: 'lease.pdf',
          sizeBytes: 2048,
          task: { id: task.id, title: 'Lease scan' },
        }),
      ]);

      await request(server()).get(projectUrl(scope, '/files')).set(as(scope.outsider)).expect(404);
    });
  });
});
