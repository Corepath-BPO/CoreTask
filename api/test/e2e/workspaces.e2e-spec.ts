import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Workspaces (e2e)', () => {
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

  const registerUser = async (name = 'Test User'): Promise<string> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);

    return response.body.data.accessToken as string;
  };

  const createWorkspace = async (token: string, name = 'Acme Product') => {
    const response = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);

    return response.body.data;
  };

  describe('creation', () => {
    it('creates a workspace and makes the creator its OWNER', async () => {
      const token = await registerUser();

      const response = await request(server())
        .post(url('/workspaces'))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Acme Product', description: 'Everything Acme ships' })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        meta: null,
        data: {
          name: 'Acme Product',
          slug: 'acme-product',
          description: 'Everything Acme ships',
          role: WorkspaceRole.OWNER,
          memberCount: 1,
          projectCount: 0,
        },
      });

      const membership = await context.prisma.workspaceMember.findFirst({
        where: { workspaceId: response.body.data.id },
      });
      expect(membership?.role).toBe(WorkspaceRole.OWNER);
    });

    it('derives a ticket prefix from the name', async () => {
      const token = await registerUser();
      const workspace = await createWorkspace(token, 'Acme Product');
      expect(workspace.ticketPrefix).toBe('ACME');
    });

    it('falls back to a safe prefix when the name has no letters', async () => {
      const token = await registerUser();
      const workspace = await createWorkspace(token, '!!! ???');
      expect(workspace.ticketPrefix).toBe('TASK');
    });

    it('disambiguates a slug that is already taken', async () => {
      const first = await registerUser('First Owner');
      const second = await registerUser('Second Owner');

      const a = await createWorkspace(first, 'Shared Name');
      const b = await createWorkspace(second, 'Shared Name');

      expect(a.slug).toBe('shared-name');
      expect(b.slug).toBe('shared-name-2');
    });

    it('records an activity-log entry', async () => {
      const token = await registerUser();
      const workspace = await createWorkspace(token);

      const logs = await context.prisma.activityLog.findMany({
        where: { workspaceId: workspace.id },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ action: 'CREATED', entity: 'WORKSPACE' });
    });

    it('requires authentication', async () => {
      const response = await request(server())
        .post(url('/workspaces'))
        .send({ name: 'Anonymous Co' })
        .expect(401);

      expect(response.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects an empty name', async () => {
      const token = await registerUser();

      const response = await request(server())
        .post(url('/workspaces'))
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })
        .expect(422);

      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('listing', () => {
    it('returns only the workspaces the caller belongs to', async () => {
      const owner = await registerUser('Owner');
      const outsider = await registerUser('Outsider');

      await createWorkspace(owner, 'Mine One');
      await createWorkspace(owner, 'Mine Two');
      await createWorkspace(outsider, 'Theirs');

      const response = await request(server())
        .get(url('/workspaces'))
        .set('Authorization', `Bearer ${owner}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((w: { name: string }) => w.name).sort()).toEqual([
        'Mine One',
        'Mine Two',
      ]);
    });

    it('returns an empty list for a user with no workspaces', async () => {
      const token = await registerUser();

      const response = await request(server())
        .get(url('/workspaces'))
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  describe('tenant isolation', () => {
    it('hides a workspace from a non-member', async () => {
      const owner = await registerUser('Owner');
      const outsider = await registerUser('Outsider');
      const workspace = await createWorkspace(owner);

      const response = await request(server())
        .get(url(`/workspaces/${workspace.id}`))
        .set('Authorization', `Bearer ${outsider}`)
        .expect(403);

      expect(response.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('blocks a non-member from updating it', async () => {
      const owner = await registerUser('Owner');
      const outsider = await registerUser('Outsider');
      const workspace = await createWorkspace(owner);

      await request(server())
        .patch(url(`/workspaces/${workspace.id}`))
        .set('Authorization', `Bearer ${outsider}`)
        .send({ name: 'Hijacked' })
        .expect(403);

      const unchanged = await context.prisma.workspace.findUnique({ where: { id: workspace.id } });
      expect(unchanged?.name).toBe('Acme Product');
    });

    it('blocks a non-member from reading the member list', async () => {
      const owner = await registerUser('Owner');
      const outsider = await registerUser('Outsider');
      const workspace = await createWorkspace(owner);

      await request(server())
        .get(url(`/workspaces/${workspace.id}/members`))
        .set('Authorization', `Bearer ${outsider}`)
        .expect(403);
    });

    it('answers a malformed id with 400, not a 500 from the database', async () => {
      const token = await registerUser();

      const response = await request(server())
        .get(url('/workspaces/not-a-uuid'))
        .set('Authorization', `Bearer ${token}`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('returns 403 rather than 404 for an unknown id, so ids cannot be probed', async () => {
      const token = await registerUser();

      const response = await request(server())
        .get(url('/workspaces/019fc880-0000-7000-8000-000000000000'))
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(response.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });
  });

  describe('role enforcement', () => {
    /** Adds an existing user to a workspace at the given role. */
    const addMember = async (workspaceId: string, email: string, role: WorkspaceRole) => {
      const user = await context.prisma.user.findUniqueOrThrow({ where: { email } });
      await context.prisma.workspaceMember.create({
        data: { workspaceId, userId: user.id, role },
      });
    };

    const registerNamed = async (): Promise<{ token: string; email: string }> => {
      const email = uniqueEmail();
      const response = await request(server())
        .post(url('/auth/register'))
        .send({ name: 'Member', email, password: VALID_PASSWORD })
        .expect(201);

      return { token: response.body.data.accessToken as string, email };
    };

    it('lets an OWNER update the workspace', async () => {
      const owner = await registerUser('Owner');
      const workspace = await createWorkspace(owner);

      const response = await request(server())
        .patch(url(`/workspaces/${workspace.id}`))
        .set('Authorization', `Bearer ${owner}`)
        .send({ name: 'Acme Renamed' })
        .expect(200);

      expect(response.body.data.name).toBe('Acme Renamed');
    });

    it('lets a MEMBER read but not update', async () => {
      const owner = await registerUser('Owner');
      const workspace = await createWorkspace(owner);
      const member = await registerNamed();
      await addMember(workspace.id, member.email, WorkspaceRole.MEMBER);

      await request(server())
        .get(url(`/workspaces/${workspace.id}`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);

      const denied = await request(server())
        .patch(url(`/workspaces/${workspace.id}`))
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Member Rename' })
        .expect(403);

      expect(denied.body.error.code).toBe('INSUFFICIENT_WORKSPACE_ROLE');
    });

    it('lets an ADMIN update the workspace', async () => {
      const owner = await registerUser('Owner');
      const workspace = await createWorkspace(owner);
      const admin = await registerNamed();
      await addMember(workspace.id, admin.email, WorkspaceRole.ADMIN);

      await request(server())
        .patch(url(`/workspaces/${workspace.id}`))
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ description: 'Updated by an admin' })
        .expect(200);
    });

    it('lists members with their roles', async () => {
      const owner = await registerUser('Owner');
      const workspace = await createWorkspace(owner);
      const member = await registerNamed();
      await addMember(workspace.id, member.email, WorkspaceRole.MEMBER);

      const response = await request(server())
        .get(url(`/workspaces/${workspace.id}/members`))
        .set('Authorization', `Bearer ${owner}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.map((m: { role: string }) => m.role).sort()).toEqual([
        'MEMBER',
        'OWNER',
      ]);
    });
  });
});
