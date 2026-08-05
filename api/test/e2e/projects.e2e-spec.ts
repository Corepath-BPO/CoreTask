import { API_PREFIX, DEFAULT_SECTION_NAMES, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Projects (e2e)', () => {
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
    email: string;
  }

  const registerUser = async (name = 'Test User'): Promise<Actor> => {
    const email = uniqueEmail();
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email, password: VALID_PASSWORD })
      .expect(201);

    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
      email,
    };
  };

  const createWorkspace = async (actor: Actor, name = 'Acme Product'): Promise<string> => {
    const response = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ name })
      .expect(201);

    return response.body.data.id as string;
  };

  const addMember = async (workspaceId: string, actor: Actor, role: WorkspaceRole) => {
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: actor.userId, role },
    });
  };

  const createProject = async (workspaceId: string, actor: Actor, body: object = {}) => {
    const response = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ name: 'Platform Foundation', ...body })
      .expect(201);

    return response.body.data;
  };

  describe('creation', () => {
    it('creates a project with default sections and a derived key', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);

      const response = await request(server())
        .post(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Platform Foundation', description: 'The core' })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        meta: null,
        data: {
          name: 'Platform Foundation',
          key: 'PF',
          description: 'The core',
          status: 'PLANNING',
          taskCount: 0,
          completedTaskCount: 0,
          sectionCount: DEFAULT_SECTION_NAMES.length,
          archivedAt: null,
        },
      });

      expect(response.body.data.sections.map((s: { name: string }) => s.name)).toEqual([
        ...DEFAULT_SECTION_NAMES,
      ]);
    });

    it('orders the default sections and spaces their positions', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      const positions = project.sections.map((s: { position: number }) => s.position);
      expect(positions).toEqual([...positions].sort((a: number, b: number) => a - b));
      expect(new Set(positions).size).toBe(positions.length);
    });

    it('derives a key from initials for a multi-word name', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner, { name: 'Customer Onboarding Flow' });
      expect(project.key).toBe('COF');
    });

    it('derives a prefix key for a single-word name', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner, { name: 'Platform' });
      expect(project.key).toBe('PLAT');
    });

    it('accepts an explicit key', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner, { key: 'core' });
      expect(project.key).toBe('CORE');
    });

    it('disambiguates a key that is already taken in the workspace', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);

      const first = await createProject(workspaceId, owner, { name: 'Platform' });
      const second = await createProject(workspaceId, owner, { name: 'Platform Two', key: 'PLAT' });

      expect(first.key).toBe('PLAT');
      expect(second.key).toBe('PLAT2');
    });

    it('lets the same key exist in a different workspace', async () => {
      const owner = await registerUser();
      const first = await createWorkspace(owner, 'First Workspace');
      const second = await createWorkspace(owner, 'Second Workspace');

      const a = await createProject(first, owner, { key: 'CORE' });
      const b = await createProject(second, owner, { key: 'CORE' });

      expect(a.key).toBe('CORE');
      expect(b.key).toBe('CORE');
    });

    it('rejects a lead who is not a workspace member', async () => {
      const owner = await registerUser();
      const outsider = await registerUser('Outsider');
      const workspaceId = await createWorkspace(owner);

      const response = await request(server())
        .post(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Leaky', leadId: outsider.userId })
        .expect(400);

      expect(response.body.error.message).toMatch(/workspace member/i);
    });

    it('accepts a lead who is a member', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner, { leadId: owner.userId });

      expect(project.leadId).toBe(owner.userId);
      expect(project.lead.email).toBe(owner.email);
    });

    it('rejects a malformed key', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);

      await request(server())
        .post(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Bad Key', key: '1AB' })
        .expect(422);
    });

    it('records an activity entry', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      const logs = await context.prisma.activityLog.findMany({
        where: { entity: 'PROJECT', entityId: project.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.action).toBe('CREATED');
    });
  });

  describe('listing', () => {
    it('returns a paginated envelope', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      await createProject(workspaceId, owner, { name: 'Alpha' });
      await createProject(workspaceId, owner, { name: 'Beta' });

      const response = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(response.body.meta).toMatchObject({ page: 1, total: 2, totalPages: 1 });
      expect(response.body.data.map((p: { name: string }) => p.name)).toEqual(['Alpha', 'Beta']);
    });

    it('hides archived projects by default and includes them on request', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner, { name: 'Retired' });
      await createProject(workspaceId, owner, { name: 'Active One' });

      await request(server())
        .delete(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      const hidden = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(hidden.body.data).toHaveLength(1);

      const shown = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects?includeArchived=true`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(shown.body.data).toHaveLength(2);
    });

    it('filters by status', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      await createProject(workspaceId, owner, { name: 'Planned' });
      await createProject(workspaceId, owner, { name: 'Running', status: 'ACTIVE' });

      const response = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects?status=ACTIVE`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Running');
    });

    it('searches by name and by key, case-insensitively', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      await createProject(workspaceId, owner, { name: 'Mobile App', key: 'MOB' });
      await createProject(workspaceId, owner, { name: 'Billing', key: 'BILL' });

      const byName = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects?search=mobile`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(byName.body.data).toHaveLength(1);

      const byKey = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects?search=bill`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(byKey.body.data[0].key).toBe('BILL');
    });

    it('never returns another workspace’s projects', async () => {
      const owner = await registerUser();
      const mine = await createWorkspace(owner, 'Mine');
      const theirs = await createWorkspace(owner, 'Theirs');

      await createProject(mine, owner, { name: 'Mine Only' });
      await createProject(theirs, owner, { name: 'Theirs Only' });

      const response = await request(server())
        .get(url(`/workspaces/${mine}/projects`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Mine Only');
    });
  });

  describe('detail', () => {
    it('returns the project with its ordered sections', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const created = await createProject(workspaceId, owner);

      const response = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects/${created.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(response.body.data.sections).toHaveLength(DEFAULT_SECTION_NAMES.length);
    });

    it('404s for a project in another workspace', async () => {
      const owner = await registerUser();
      const mine = await createWorkspace(owner, 'Mine');
      const theirs = await createWorkspace(owner, 'Theirs');
      const project = await createProject(theirs, owner);

      await request(server())
        .get(url(`/workspaces/${mine}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(404);
    });
  });

  describe('default work-item type', () => {
    it('starts as TASK, which is what the board already created', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      expect(project.defaultWorkItemType).toBe('TASK');
    });

    it('can be chosen at creation', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);

      const response = await request(server())
        .post(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Support Queue', defaultWorkItemType: 'TICKET' })
        .expect(201);

      expect(response.body.data.defaultWorkItemType).toBe('TICKET');
    });

    it('can be changed later, and persists', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      await request(server())
        .patch(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ defaultWorkItemType: 'TICKET' })
        .expect(200);

      const reread = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(reread.body.data.defaultWorkItemType).toBe('TICKET');
    });

    it('refuses a type that cannot be created', async () => {
      /*
       * The whole point of narrowing the enum. A project defaulting to
       * Milestone would render "+ Add milestone" on a button whose click the
       * API refuses — a control that lies about what it does.
       */
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      for (const type of ['MILESTONE', 'APPROVAL', 'EPIC']) {
        await request(server())
          .patch(url(`/workspaces/${workspaceId}/projects/${project.id}`))
          .set('Authorization', `Bearer ${owner.token}`)
          .send({ defaultWorkItemType: type })
          .expect(422);
      }
    });
  });

  describe('update', () => {
    it('updates the editable fields', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      const response = await request(server())
        .patch(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Renamed', status: 'ACTIVE', color: '#0EA5E9' })
        .expect(200);

      expect(response.body.data).toMatchObject({
        name: 'Renamed',
        status: 'ACTIVE',
        color: '#0EA5E9',
      });
    });

    it('stamps completedAt when the status becomes COMPLETED, and clears it on the way back', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      const completed = await request(server())
        .patch(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ status: 'COMPLETED' })
        .expect(200);
      expect(completed.body.data.completedAt).not.toBeNull();

      const reopened = await request(server())
        .patch(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ status: 'ACTIVE' })
        .expect(200);
      expect(reopened.body.data.completedAt).toBeNull();
    });

    it('ignores an attempt to change the key', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      // `forbidNonWhitelisted` makes an unknown property an error rather than a
      // silent no-op, which is what keeps the key genuinely immutable.
      await request(server())
        .patch(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ key: 'HACKED' })
        .expect(422);

      const unchanged = await context.prisma.project.findUniqueOrThrow({
        where: { id: project.id },
      });
      expect(unchanged.key).toBe(project.key);
    });

    it('clears the description when null is sent', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner, { description: 'temporary' });

      const response = await request(server())
        .patch(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ description: null })
        .expect(200);

      expect(response.body.data.description).toBeNull();
    });

    it('rejects an empty patch', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      await request(server())
        .patch(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({})
        .expect(400);
    });
  });

  describe('archive and restore', () => {
    it('archives, then restores', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      const archived = await request(server())
        .delete(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(archived.body.data.archivedAt).not.toBeNull();
      expect(archived.body.data.status).toBe('ARCHIVED');

      const restored = await request(server())
        .post(url(`/workspaces/${workspaceId}/projects/${project.id}/restore`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);
      expect(restored.body.data.archivedAt).toBeNull();
      expect(restored.body.data.status).toBe('ACTIVE');
    });

    it('keeps the row rather than deleting it', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      await request(server())
        .delete(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      const row = await context.prisma.project.findUnique({ where: { id: project.id } });
      expect(row).not.toBeNull();
      expect(row?.archivedAt).not.toBeNull();
    });

    it('refuses to archive twice', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      await request(server())
        .delete(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      await request(server())
        .delete(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(409);
    });

    it('refuses to restore a project that is not archived', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner);

      await request(server())
        .post(url(`/workspaces/${workspaceId}/projects/${project.id}/restore`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(409);
    });
  });

  describe('authorisation', () => {
    it('requires authentication', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);

      await request(server())
        .get(url(`/workspaces/${workspaceId}/projects`))
        .expect(401);
    });

    it('hides projects from a non-member of the workspace', async () => {
      const owner = await registerUser();
      const outsider = await registerUser('Outsider');
      const workspaceId = await createWorkspace(owner);
      await createProject(workspaceId, owner);

      const response = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);

      expect(response.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('lets a GUEST read but not create', async () => {
      const owner = await registerUser();
      const guest = await registerUser('Guest');
      const workspaceId = await createWorkspace(owner);
      await addMember(workspaceId, guest, WorkspaceRole.GUEST);

      await request(server())
        .get(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${guest.token}`)
        .expect(200);

      const denied = await request(server())
        .post(url(`/workspaces/${workspaceId}/projects`))
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ name: 'Guest Project' })
        .expect(403);

      expect(denied.body.error.code).toBe('INSUFFICIENT_WORKSPACE_ROLE');
    });

    it('lets a MEMBER create and edit but not archive', async () => {
      const owner = await registerUser();
      const member = await registerUser('Member');
      const workspaceId = await createWorkspace(owner);
      await addMember(workspaceId, member, WorkspaceRole.MEMBER);

      const created = await createProject(workspaceId, member, { name: 'Member Project' });

      await request(server())
        .patch(url(`/workspaces/${workspaceId}/projects/${created.id}`))
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Member Renamed' })
        .expect(200);

      const denied = await request(server())
        .delete(url(`/workspaces/${workspaceId}/projects/${created.id}`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);

      expect(denied.body.error.code).toBe('INSUFFICIENT_WORKSPACE_ROLE');
    });

    it('lets a MANAGER archive', async () => {
      const owner = await registerUser();
      const manager = await registerUser('Manager');
      const workspaceId = await createWorkspace(owner);
      await addMember(workspaceId, manager, WorkspaceRole.MANAGER);
      const project = await createProject(workspaceId, owner);

      await request(server())
        .delete(url(`/workspaces/${workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);
    });
  });
});
