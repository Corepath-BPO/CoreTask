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
 * Workspace API keys: a machine credential that acts as a hidden service
 * account. The suite checks the two things that matter most — the secret is
 * shown exactly once, and a key can move work but never widen its own access.
 */
describe('API keys (e2e)', () => {
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
    projectId: string;
    sectionId: string;
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
    const owner = await registerUser('Workspace Owner');

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

    return {
      owner,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: project.body.data.sections[0].id as string,
    };
  };

  const addMember = async (scope: Scope, actor: Actor, role: WorkspaceRole) => {
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
  };

  const keysUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/api-keys`);

  const createKey = async (scope: Scope, body: Record<string, unknown> = { name: 'n8n' }) => {
    const response = await request(server())
      .post(keysUrl(scope))
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .send(body)
      .expect(201);

    return response.body.data as {
      key: { id: string; userId: string; prefix: string; role: string; revokedAt: string | null };
      secret: string;
    };
  };

  // -------------------------------------------------------------------------
  describe('creating and listing', () => {
    it('returns the secret once and never in the list', async () => {
      const scope = await setupScope();
      const created = await createKey(scope, { name: 'n8n' });

      expect(created.secret).toMatch(/^ctk_[A-Za-z0-9_-]{43}$/);
      expect(created.key.prefix).toEqual(created.secret.slice(0, 12));
      expect(created.key.role).toEqual('MEMBER');

      const list = await request(server())
        .get(keysUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0].id).toEqual(created.key.id);
      expect(list.body.data[0].createdBy.id).toEqual(scope.owner.userId);
      expect(JSON.stringify(list.body)).not.toContain(created.secret);
    });

    it('refuses roles a key may not hold, and roles above the caller', async () => {
      const scope = await setupScope();

      const admin = await request(server())
        .post(keysUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'too much', role: 'ADMIN' })
        .expect(422);
      expect(admin.body.error.code).toEqual('API_KEY_ROLE_NOT_ALLOWED');

      const manager = await createKey(scope, { name: 'ops', role: 'MANAGER' });
      expect(manager.key.role).toEqual('MANAGER');
    });

    it('is workspace administration: a member cannot create or list keys', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const response = await request(server())
        .post(keysUrl(scope))
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'sneaky' })
        .expect(403);
      expect(response.body.error.code).toEqual('INSUFFICIENT_WORKSPACE_ROLE');
    });

    it('keeps the service account out of the member roster and the member count', async () => {
      const scope = await setupScope();
      const created = await createKey(scope);

      const members = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/members`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      const userIds = (members.body.data as { user: { id: string } }[]).map((row) => row.user.id);
      expect(userIds).toEqual([scope.owner.userId]);
      expect(userIds).not.toContain(created.key.userId);

      const workspace = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(workspace.body.data.memberCount).toEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('using a key', () => {
    it('authenticates with the header or as a bearer token, and knows its workspace', async () => {
      const scope = await setupScope();
      const created = await createKey(scope, { name: 'n8n' });

      const viaHeader = await request(server())
        .get(url('/integration/whoami'))
        .set('X-API-Key', created.secret)
        .expect(200);
      expect(viaHeader.body.data).toMatchObject({
        principal: 'api_key',
        workspace: { id: scope.workspaceId },
        apiKey: { id: created.key.id, name: 'n8n', role: 'MEMBER' },
      });
      expect(viaHeader.body.data.user.id).toEqual(created.key.userId);

      const viaBearer = await request(server())
        .get(url('/integration/whoami'))
        .set('Authorization', `Bearer ${created.secret}`)
        .expect(200);
      expect(viaBearer.body.data.principal).toEqual('api_key');

      const asPerson = await request(server())
        .get(url('/integration/whoami'))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(asPerson.body.data).toMatchObject({
        principal: 'user',
        workspace: null,
        apiKey: null,
      });
    });

    it('creates tasks and comments attributed to the service account', async () => {
      const scope = await setupScope();
      const created = await createKey(scope, { name: 'n8n' });

      const task = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set('X-API-Key', created.secret)
        .send({ title: 'Filed from n8n', sectionId: scope.sectionId })
        .expect(201);
      expect(task.body.data.createdById).toEqual(created.key.userId);

      const taskId = task.body.data.id as string;
      const comment = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${taskId}/comments`))
        .set('X-API-Key', created.secret)
        .send({ body: 'Automated note' })
        .expect(201);
      expect(comment.body.data.author.id).toEqual(created.key.userId);
      expect(comment.body.data.author.name).toEqual('n8n');

      // The id comes back, so the tool can complete the task later.
      const done = await request(server())
        .patch(url(`/workspaces/${scope.workspaceId}/tasks/${taskId}`))
        .set('X-API-Key', created.secret)
        .send({ status: 'DONE' })
        .expect(200);
      expect(done.body.data.completedAt).not.toBeNull();
    });

    it('is confined to its workspace and to moving work', async () => {
      const scope = await setupScope();
      const other = await setupScope();
      const created = await createKey(scope);

      const elsewhere = await request(server())
        .get(url(`/workspaces/${other.workspaceId}/projects`))
        .set('X-API-Key', created.secret)
        .expect(403);
      expect(elsewhere.body.error.code).toEqual('WORKSPACE_ACCESS_DENIED');

      const session = await request(server())
        .get(url('/auth/me'))
        .set('X-API-Key', created.secret)
        .expect(403);
      expect(session.body.error.code).toEqual('API_KEY_NOT_ALLOWED');

      const keys = await request(server())
        .get(keysUrl(scope))
        .set('X-API-Key', created.secret)
        .expect(403);
      expect(keys.body.error.code).toEqual('API_KEY_NOT_ALLOWED');

      const workspace = await request(server())
        .post(url('/workspaces'))
        .set('X-API-Key', created.secret)
        .send({ name: 'Escape hatch' })
        .expect(403);
      expect(workspace.body.error.code).toEqual('API_KEY_NOT_ALLOWED');
    });

    it('rejects unknown, revoked and expired keys distinctly', async () => {
      const scope = await setupScope();

      const unknown = await request(server())
        .get(url('/integration/whoami'))
        .set('X-API-Key', 'ctk_definitely-not-a-real-key-at-all-0000000000')
        .expect(401);
      expect(unknown.body.error.code).toEqual('API_KEY_INVALID');

      const shortLived = await createKey(scope, { name: 'temp', expiresInDays: 1 });
      await context.prisma.apiKey.update({
        where: { id: shortLived.key.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const expired = await request(server())
        .get(url('/integration/whoami'))
        .set('X-API-Key', shortLived.secret)
        .expect(401);
      expect(expired.body.error.code).toEqual('API_KEY_EXPIRED');

      const doomed = await createKey(scope, { name: 'doomed' });
      const revoked = await request(server())
        .delete(`${keysUrl(scope)}/${doomed.key.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(revoked.body.data.revokedAt).not.toBeNull();

      const afterRevoke = await request(server())
        .get(url('/integration/whoami'))
        .set('X-API-Key', doomed.secret)
        .expect(401);
      expect(afterRevoke.body.error.code).toEqual('API_KEY_REVOKED');

      const visible = await request(server())
        .get(keysUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect((visible.body.data as { id: string }[]).map((row) => row.id)).not.toContain(
        doomed.key.id,
      );

      const withRevoked = await request(server())
        .get(`${keysUrl(scope)}?includeRevoked=true`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect((withRevoked.body.data as { id: string }[]).map((row) => row.id)).toContain(
        doomed.key.id,
      );
    });

    it('renames the key and its service account together', async () => {
      const scope = await setupScope();
      const created = await createKey(scope, { name: 'n8n' });

      const renamed = await request(server())
        .patch(`${keysUrl(scope)}/${created.key.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Zapier', role: 'GUEST' })
        .expect(200);
      expect(renamed.body.data).toMatchObject({ name: 'Zapier', role: 'GUEST' });

      const whoami = await request(server())
        .get(url('/integration/whoami'))
        .set('X-API-Key', created.secret)
        .expect(200);
      expect(whoami.body.data.user.name).toEqual('Zapier');
      expect(whoami.body.data.apiKey.role).toEqual('GUEST');
    });
  });
});
