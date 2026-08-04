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
 * These talk to the real MinIO the dev stack runs, not a mock.
 *
 * That is the point: the properties worth guarding here are properties of the
 * storage service's actual behaviour — that a presigned PUT enforces the
 * content type it was signed for but *cannot* enforce a size, that a download
 * comes back as an attachment, that deleting removes the bytes. A stub would
 * assert what this code believes about S3, which is exactly the thing that was
 * wrong twice while building it.
 */
describe('Attachments (e2e)', () => {
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

  interface Scope {
    owner: Actor;
    workspaceId: string;
    taskId: string;
    ticketId: string;
    ticketKey: string;
  }

  const registerUser = async (name = 'Test User'): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);

    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser();

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Acme Product' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Platform Foundation' })
      .expect(201);

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'A task', sectionId: project.body.data.sections[0].id })
      .expect(201);

    const ticket = await request(server())
      .post(url(`/workspaces/${workspaceId}/tickets`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Something is broken' })
      .expect(201);

    return {
      owner,
      workspaceId,
      taskId: task.body.data.id as string,
      ticketId: ticket.body.data.id as string,
      ticketKey: ticket.body.data.key as string,
    };
  };

  const addMember = async (scope: Scope, actor: Actor, role: WorkspaceRole) => {
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
  };

  const attachmentsUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/attachments`);

  const declare = (scope: Scope, actor: Actor, body: Record<string, unknown>) =>
    request(server())
      .post(attachmentsUrl(scope))
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 12, ...body });

  /** Declares, PUTs the bytes, and confirms — the whole happy path. */
  const attach = async (
    scope: Scope,
    actor: Actor,
    body: Buffer,
    overrides: Record<string, unknown> = {},
  ) => {
    const created = await declare(scope, actor, {
      sizeBytes: body.length,
      taskId: scope.taskId,
      ...overrides,
    }).expect(201);

    const { attachment, uploadUrl, uploadHeaders } = created.body.data;
    const put = await fetch(uploadUrl, { method: 'PUT', headers: uploadHeaders, body });
    expect(put.ok).toBe(true);

    const confirmed = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}/confirm`))
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(200);

    return confirmed.body.data;
  };

  describe('declaring an upload', () => {
    it('returns a presigned PUT and never the storage key', async () => {
      const scope = await setupScope();

      const response = await declare(scope, scope.owner, { taskId: scope.taskId }).expect(201);

      expect(response.body.data.uploadUrl).toContain('X-Amz-Signature');
      expect(response.body.data.attachment.status).toBe('PENDING');
      expect(response.body.data.attachment).not.toHaveProperty('objectKey');
    });

    it('refuses a file type that is not on the list', async () => {
      const scope = await setupScope();

      await declare(scope, scope.owner, {
        filename: 'payload.exe',
        mimeType: 'application/x-msdownload',
        taskId: scope.taskId,
      }).expect(422);
    });

    it('refuses a filename that looks like a path', async () => {
      const scope = await setupScope();

      await declare(scope, scope.owner, {
        filename: '../../etc/passwd',
        taskId: scope.taskId,
      }).expect(422);
    });

    it('refuses a declaration over the size limit', async () => {
      const scope = await setupScope();

      await declare(scope, scope.owner, {
        sizeBytes: 26 * 1024 * 1024,
        taskId: scope.taskId,
      }).expect(400);
    });

    /*
     * Both ids used to be accepted, and the service silently took the task —
     * an upload aimed at a ticket landed somewhere else with no error.
     */
    it('refuses two parents rather than silently picking one', async () => {
      const scope = await setupScope();

      await declare(scope, scope.owner, {
        taskId: scope.taskId,
        ticketId: scope.ticketId,
      }).expect(400);
    });

    it('refuses no parent at all', async () => {
      const scope = await setupScope();

      await declare(scope, scope.owner, {}).expect(400);
    });

    it('does not reach across workspaces', async () => {
      const scope = await setupScope();
      const other = await setupScope();

      await declare(scope, scope.owner, { taskId: other.taskId }).expect(404);
    });

    it('refuses a non-member', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await declare(scope, stranger, { taskId: scope.taskId }).expect(403);
    });
  });

  describe('the upload itself', () => {
    it('rejects a content-type other than the one it was signed for', async () => {
      const scope = await setupScope();
      const created = await declare(scope, scope.owner, {
        mimeType: 'image/png',
        filename: 'a.png',
        taskId: scope.taskId,
      }).expect(201);

      // The signature covers content-type, so swapping it is refused outright
      // rather than being caught later at confirm.
      const response = await fetch(created.body.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'text/html' },
        body: Buffer.from('<script>alert(1)</script>'),
      });

      expect(response.status).toBe(403);
    });
  });

  describe('confirming', () => {
    it('makes the attachment visible and records the stored size', async () => {
      const scope = await setupScope();
      const body = Buffer.from('some notes');

      const attachment = await attach(scope, scope.owner, body);

      expect(attachment.status).toBe('READY');
      expect(attachment.sizeBytes).toBe(body.length);

      const list = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/attachments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(list.body.data).toHaveLength(1);
    });

    /*
     * The reason confirm exists. A presigned PUT has no way to express a size
     * limit, so a URL issued for twelve bytes accepts as much as the client
     * cares to send; only re-reading the stored object catches it.
     */
    it('rejects an upload far larger than what was declared, and drops it', async () => {
      const scope = await setupScope();
      const created = await declare(scope, scope.owner, {
        sizeBytes: 12,
        taskId: scope.taskId,
      }).expect(201);

      const { attachment, uploadUrl, uploadHeaders } = created.body.data;
      const oversize = Buffer.alloc(26 * 1024 * 1024, 1);
      const put = await fetch(uploadUrl, { method: 'PUT', headers: uploadHeaders, body: oversize });
      expect(put.ok).toBe(true);

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}/confirm`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);

      const row = await context.prisma.attachment.findUnique({ where: { id: attachment.id } });
      expect(row).toBeNull();
    });

    it('refuses when nothing was ever uploaded', async () => {
      const scope = await setupScope();
      const created = await declare(scope, scope.owner, { taskId: scope.taskId }).expect(201);

      await request(server())
        .post(
          url(`/workspaces/${scope.workspaceId}/attachments/${created.body.data.attachment.id}/confirm`),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);
    });

    it('is a no-op the second time rather than an error', async () => {
      const scope = await setupScope();
      const attachment = await attach(scope, scope.owner, Buffer.from('twice'));

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}/confirm`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
    });

    it('is not something a bystander can do for you', async () => {
      const scope = await setupScope();
      const other = await registerUser('Other');
      await addMember(scope, other, WorkspaceRole.MEMBER);

      const created = await declare(scope, scope.owner, { taskId: scope.taskId }).expect(201);

      await request(server())
        .post(
          url(`/workspaces/${scope.workspaceId}/attachments/${created.body.data.attachment.id}/confirm`),
        )
        .set('Authorization', `Bearer ${other.token}`)
        .expect(403);
    });
  });

  describe('listing', () => {
    it('hides an upload that was never confirmed', async () => {
      const scope = await setupScope();
      await declare(scope, scope.owner, { taskId: scope.taskId }).expect(201);

      const list = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/attachments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(list.body.data).toEqual([]);
    });

    it('reads a ticket’s files by key as well as by id', async () => {
      const scope = await setupScope();
      await attach(scope, scope.owner, Buffer.from('ticket file'), {
        taskId: undefined,
        ticketId: scope.ticketId,
      });

      for (const ref of [scope.ticketId, scope.ticketKey]) {
        const list = await request(server())
          .get(url(`/workspaces/${scope.workspaceId}/tickets/${ref}/attachments`))
          .set('Authorization', `Bearer ${scope.owner.token}`)
          .expect(200);

        expect(list.body.data).toHaveLength(1);
      }
    });
  });

  describe('downloading', () => {
    it('hands back a short-lived URL that forces a download', async () => {
      const scope = await setupScope();
      const body = Buffer.from('the actual bytes');
      const attachment = await attach(scope, scope.owner, body);

      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}/download`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const fetched = await fetch(response.body.data.url);
      expect(await fetched.arrayBuffer()).toHaveProperty('byteLength', body.length);

      // An SVG can carry script, and SVG is an accepted upload type, so nothing
      // may ever be rendered inline from the storage origin.
      expect(fetched.headers.get('content-disposition')).toMatch(/^attachment/);
    });

    it('does not serve a file from another workspace', async () => {
      const scope = await setupScope();
      const other = await setupScope();
      const attachment = await attach(other, other.owner, Buffer.from('theirs'));

      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}/download`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });
  });

  describe('deleting', () => {
    it('removes the row and the bytes together', async () => {
      const scope = await setupScope();
      const attachment = await attach(scope, scope.owner, Buffer.from('short lived'));

      const link = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}/download`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      // The URL was valid a moment ago, so a 404 now is the object being gone
      // rather than the link having expired.
      const stale = await fetch(link.body.data.url);
      expect(stale.status).toBe(404);
    });

    it('lets a manager remove someone else’s file', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);
      const manager = await registerUser('Manager');
      await addMember(scope, manager, WorkspaceRole.MANAGER);

      const attachment = await attach(scope, member, Buffer.from('theirs'));

      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}`))
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);
    });

    it('refuses a peer who did not upload it', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);
      const peer = await registerUser('Peer');
      await addMember(scope, peer, WorkspaceRole.MEMBER);

      const attachment = await attach(scope, member, Buffer.from('theirs'));

      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/attachments/${attachment.id}`))
        .set('Authorization', `Bearer ${peer.token}`)
        .expect(403);
    });
  });
});
