import { API_PREFIX, ProjectMemberRole, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  confirmEmail,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Admin console (e2e)', () => {
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
    await confirmEmail(context, response.body.data.user.id as string);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser('Owner');
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

  /** Returns the membership row id, which the member endpoints address. */
  const join = async (scope: Scope, actor: Actor, role: WorkspaceRole): Promise<string> => {
    const member = await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
    return member.id;
  };

  const membershipOf = (scope: Scope, actor: Actor) =>
    context.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actor.userId } },
    });

  const adminUrl = (scope: Scope, path: string) =>
    url(`/workspaces/${scope.workspaceId}/admin${path}`);

  const as = (actor: Actor) => ({
    get: (path: string) =>
      request(server()).get(path).set('Authorization', `Bearer ${actor.token}`),
    post: (path: string, body: object = {}) =>
      request(server()).post(path).set('Authorization', `Bearer ${actor.token}`).send(body),
    patch: (path: string, body: object) =>
      request(server()).patch(path).set('Authorization', `Bearer ${actor.token}`).send(body),
  });

  /** Work in a project goes only to its members, so assignees join it first. */
  const joinProject = (scope: Scope, actor: Actor, projectId = scope.projectId) =>
    context.prisma.projectMember.create({
      data: {
        workspaceId: scope.workspaceId,
        projectId,
        userId: actor.userId,
        role: ProjectMemberRole.EDITOR,
      },
    });

  const createTask = async (scope: Scope, assigneeId: string, sectionId = scope.sectionId) => {
    const task = await as(scope.owner)
      .post(url(`/workspaces/${scope.workspaceId}/tasks`), {
        title: 'Open work',
        sectionId,
        assigneeId,
      })
      .expect(201);
    return task.body.data.id as string;
  };

  // -------------------------------------------------------------------------
  describe('who reaches it', () => {
    /** Every route, so a route added without the class's gate fails here. */
    const routes = (scope: Scope, memberId: string) => [
      { method: 'get' as const, path: adminUrl(scope, '/overview') },
      { method: 'get' as const, path: adminUrl(scope, '/members') },
      { method: 'get' as const, path: adminUrl(scope, '/teams') },
      { method: 'post' as const, path: adminUrl(scope, `/members/${memberId}/deactivate`) },
      { method: 'post' as const, path: adminUrl(scope, `/members/${memberId}/reactivate`) },
      { method: 'post' as const, path: adminUrl(scope, `/members/${memberId}/remove`) },
      {
        method: 'post' as const,
        path: adminUrl(scope, `/invitations/${memberId}/link`),
      },
    ];

    it.each([
      WorkspaceRole.ADMIN,
      WorkspaceRole.MANAGER,
      WorkspaceRole.MEMBER,
      WorkspaceRole.GUEST,
    ])('refuses a workspace %s on every route', async (role) => {
      const scope = await setupScope();
      const caller = await registerUser('Caller');
      await join(scope, caller, role);
      const target = await registerUser('Target');
      const targetId = await join(scope, target, WorkspaceRole.GUEST);

      for (const route of routes(scope, targetId)) {
        const response = await as(caller)[route.method](route.path).expect(403);
        expect(response.body.error.code).toBe('INSUFFICIENT_WORKSPACE_ROLE');
      }
      // Nothing the refused calls asked for happened.
      expect((await membershipOf(scope, target)).deactivatedAt).toBeNull();
    });

    it('refuses someone outside the workspace', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      const response = await as(stranger).get(adminUrl(scope, '/overview')).expect(403);
      expect(response.body.error.code).toBe('WORKSPACE_ACCESS_DENIED');
    });

    it('refuses an anonymous caller', async () => {
      const scope = await setupScope();
      await request(server()).get(adminUrl(scope, '/overview')).expect(401);
    });

    /** A key acts for a workspace, never as a person running it. */
    it('refuses an API key, whatever role it holds', async () => {
      const scope = await setupScope();
      const created = await as(scope.owner)
        .post(url(`/workspaces/${scope.workspaceId}/api-keys`), {
          name: 'ops',
          role: WorkspaceRole.MANAGER,
        })
        .expect(201);
      const secret = created.body.data.secret as string;

      await request(server())
        .get(adminUrl(scope, '/overview'))
        .set('Authorization', `Bearer ${secret}`)
        .expect(403);
    });

    it('opens to the owner and to a super admin', async () => {
      const scope = await setupScope();
      const superAdmin = await registerUser('Super');
      await join(scope, superAdmin, WorkspaceRole.SUPER_ADMIN);

      for (const actor of [scope.owner, superAdmin]) {
        const overview = await as(actor).get(adminUrl(scope, '/overview')).expect(200);
        expect(overview.body.data.people.byRole).toMatchObject({ OWNER: 1, SUPER_ADMIN: 1 });
        expect(overview.body.data.workspace.owner.id).toBe(scope.owner.userId);
      }
    });

    it('refuses a super admin whose access was deactivated', async () => {
      const scope = await setupScope();
      const superAdmin = await registerUser('Super');
      const superAdminId = await join(scope, superAdmin, WorkspaceRole.SUPER_ADMIN);
      await as(scope.owner)
        .post(adminUrl(scope, `/members/${superAdminId}/deactivate`))
        .expect(200);

      const response = await as(superAdmin).get(adminUrl(scope, '/overview')).expect(403);
      expect(response.body.error.code).toBe('WORKSPACE_MEMBERSHIP_DEACTIVATED');
    });
  });

  // -------------------------------------------------------------------------
  describe('the super admin role', () => {
    const setRole = (scope: Scope, actor: Actor, memberId: string, role: WorkspaceRole) =>
      as(actor).patch(url(`/workspaces/${scope.workspaceId}/members/${memberId}`), { role });

    it('is granted by the owner, and by a super admin, but never by an admin', async () => {
      const scope = await setupScope();
      const superAdmin = await registerUser('Super');
      await join(scope, superAdmin, WorkspaceRole.SUPER_ADMIN);
      const admin = await registerUser('Admin');
      await join(scope, admin, WorkspaceRole.ADMIN);
      const first = await registerUser('First');
      const firstId = await join(scope, first, WorkspaceRole.MEMBER);
      const second = await registerUser('Second');
      const secondId = await join(scope, second, WorkspaceRole.ADMIN);

      await setRole(scope, admin, firstId, WorkspaceRole.SUPER_ADMIN).expect(403);
      await setRole(scope, scope.owner, firstId, WorkspaceRole.SUPER_ADMIN).expect(200);
      await setRole(scope, superAdmin, secondId, WorkspaceRole.SUPER_ADMIN).expect(200);

      expect((await membershipOf(scope, first)).role).toBe(WorkspaceRole.SUPER_ADMIN);
      expect((await membershipOf(scope, second)).role).toBe(WorkspaceRole.SUPER_ADMIN);
    });

    /** Peers cannot demote each other; only the owner outranks a super admin. */
    it('is taken away only by the owner', async () => {
      const scope = await setupScope();
      const one = await registerUser('One');
      await join(scope, one, WorkspaceRole.SUPER_ADMIN);
      const other = await registerUser('Other');
      const otherId = await join(scope, other, WorkspaceRole.SUPER_ADMIN);

      await setRole(scope, one, otherId, WorkspaceRole.ADMIN).expect(403);
      await setRole(scope, scope.owner, otherId, WorkspaceRole.ADMIN).expect(200);
    });

    it('sees every private project, as an admin does', async () => {
      const scope = await setupScope();
      const superAdmin = await registerUser('Super');
      await join(scope, superAdmin, WorkspaceRole.SUPER_ADMIN);
      const hidden = await as(scope.owner)
        .post(url(`/workspaces/${scope.workspaceId}/projects`), {
          name: 'Board only',
          visibility: 'PRIVATE',
        })
        .expect(201);

      await as(superAdmin)
        .get(url(`/workspaces/${scope.workspaceId}/projects/${hidden.body.data.id}`))
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('deactivating', () => {
    it('cuts access off but keeps the membership for reactivation', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MANAGER);

      const response = await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/deactivate`))
        .expect(200);
      expect(response.body.data.member).toMatchObject({
        status: 'DEACTIVATED',
        role: WorkspaceRole.MANAGER,
        deactivatedBy: { id: scope.owner.userId },
      });

      const denied = await as(member)
        .get(url(`/workspaces/${scope.workspaceId}/projects`))
        .expect(403);
      expect(denied.body.error.code).toBe('WORKSPACE_MEMBERSHIP_DEACTIVATED');

      // Gone from their workspace list and from everyone's pickers…
      const mine = await as(member).get(url('/workspaces')).expect(200);
      expect(mine.body.data.map((w: { id: string }) => w.id)).not.toContain(scope.workspaceId);
      const roster = await as(scope.owner)
        .get(url(`/workspaces/${scope.workspaceId}/members`))
        .expect(200);
      expect(roster.body.data.map((m: { id: string }) => m.id)).not.toContain(memberId);

      // …but the console still lists them.
      const listed = await as(scope.owner).get(adminUrl(scope, '/members')).expect(200);
      expect(listed.body.data.find((m: { id: string }) => m.id === memberId).status).toBe(
        'DEACTIVATED',
      );
    });

    it('refuses to point new work at them', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);
      await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/deactivate`))
        .expect(200);

      await as(scope.owner)
        .post(url(`/workspaces/${scope.workspaceId}/tasks`), {
          title: 'For someone gone',
          sectionId: scope.sectionId,
          assigneeId: member.userId,
        })
        .expect(400);
    });

    /** The assignee rule: a project's work goes to its members, even in a public project. */
    it('hands open work to the recipient only in projects they are a member of', async () => {
      const scope = await setupScope();
      const leaver = await registerUser('Leaver');
      const leaverId = await join(scope, leaver, WorkspaceRole.MEMBER);
      const recipient = await registerUser('Recipient');
      await join(scope, recipient, WorkspaceRole.MEMBER);
      await joinProject(scope, leaver);
      await joinProject(scope, recipient);

      const other = await as(scope.owner)
        .post(url(`/workspaces/${scope.workspaceId}/projects`), { name: 'Other board' })
        .expect(201);
      await joinProject(scope, leaver, other.body.data.id);

      const visibleTask = await createTask(scope, leaver.userId);
      const hiddenTask = await createTask(scope, leaver.userId, other.body.data.sections[0].id);

      const response = await as(scope.owner)
        .post(adminUrl(scope, `/members/${leaverId}/deactivate`), {
          reassignToUserId: recipient.userId,
        })
        .expect(200);
      expect(response.body.data).toMatchObject({ tasksReassigned: 1, tasksUnassigned: 1 });

      const [visible, invisible] = await Promise.all([
        context.prisma.task.findUniqueOrThrow({ where: { id: visibleTask } }),
        context.prisma.task.findUniqueOrThrow({ where: { id: hiddenTask } }),
      ]);
      expect(visible.assigneeId).toBe(recipient.userId);
      expect(invisible.assigneeId).toBeNull();
    });

    it('refuses a recipient who cannot get in', async () => {
      const scope = await setupScope();
      const leaver = await registerUser('Leaver');
      const leaverId = await join(scope, leaver, WorkspaceRole.MEMBER);
      const stranger = await registerUser('Stranger');

      await as(scope.owner)
        .post(adminUrl(scope, `/members/${leaverId}/deactivate`), {
          reassignToUserId: stranger.userId,
        })
        .expect(400);
      await as(scope.owner)
        .post(adminUrl(scope, `/members/${leaverId}/deactivate`), {
          reassignToUserId: leaver.userId,
        })
        .expect(400);
      expect((await membershipOf(scope, leaver)).deactivatedAt).toBeNull();
    });

    it('never reaches the owner, a peer or yourself', async () => {
      const scope = await setupScope();
      const one = await registerUser('One');
      const oneId = await join(scope, one, WorkspaceRole.SUPER_ADMIN);
      const other = await registerUser('Other');
      const otherId = await join(scope, other, WorkspaceRole.SUPER_ADMIN);
      const ownerId = (await membershipOf(scope, scope.owner)).id;

      await as(one)
        .post(adminUrl(scope, `/members/${ownerId}/deactivate`))
        .expect(400);
      await as(one)
        .post(adminUrl(scope, `/members/${otherId}/deactivate`))
        .expect(403);
      await as(one)
        .post(adminUrl(scope, `/members/${oneId}/deactivate`))
        .expect(403);
    });

    it('says so when they are already deactivated', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/deactivate`))
        .expect(200);
      await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/deactivate`))
        .expect(409);
    });

    it('is undone by reactivating, with the same role', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MANAGER);
      await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/deactivate`))
        .expect(200);

      const response = await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/reactivate`))
        .expect(200);
      expect(response.body.data).toMatchObject({ status: 'ACTIVE', role: WorkspaceRole.MANAGER });

      await as(member)
        .get(url(`/workspaces/${scope.workspaceId}/projects`))
        .expect(200);
      await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/reactivate`))
        .expect(409);
    });

    it('records both in the activity trail', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);
      await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/deactivate`))
        .expect(200);
      await as(scope.owner)
        .post(adminUrl(scope, `/members/${memberId}/reactivate`))
        .expect(200);

      const lines = await context.prisma.activityLog.findMany({
        where: { workspaceId: scope.workspaceId, entityId: member.userId },
        orderBy: { createdAt: 'asc' },
      });
      expect(lines.map((line) => line.action)).toEqual([
        'MEMBER_DEACTIVATED',
        'MEMBER_REACTIVATED',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('removing with a hand-over', () => {
    it('ends the membership and gives their open work to the recipient', async () => {
      const scope = await setupScope();
      const leaver = await registerUser('Leaver');
      const leaverId = await join(scope, leaver, WorkspaceRole.MEMBER);
      const recipient = await registerUser('Recipient');
      await join(scope, recipient, WorkspaceRole.MEMBER);
      await joinProject(scope, leaver);
      await joinProject(scope, recipient);
      const taskId = await createTask(scope, leaver.userId);

      const response = await as(scope.owner)
        .post(adminUrl(scope, `/members/${leaverId}/remove`), {
          reassignToUserId: recipient.userId,
        })
        .expect(200);
      expect(response.body.data).toMatchObject({
        removed: true,
        tasksReassigned: 1,
        tasksUnassigned: 0,
      });

      const task = await context.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.assigneeId).toBe(recipient.userId);
      expect(
        await context.prisma.workspaceMember.findUnique({ where: { id: leaverId } }),
      ).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('members and teams', () => {
    it('lists each person with their status, sign-in methods and open work', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await join(scope, member, WorkspaceRole.MEMBER);
      await joinProject(scope, member);
      await createTask(scope, member.userId);
      // An account made for someone, as the Asana import does, never signed in.
      const placeholder = await context.prisma.user.create({
        data: { email: uniqueEmail('asana'), name: 'From Asana' },
      });
      await context.prisma.workspaceMember.create({
        data: { workspaceId: scope.workspaceId, userId: placeholder.id, role: 'MEMBER' },
      });

      const response = await as(scope.owner).get(adminUrl(scope, '/members')).expect(200);
      const byUser = new Map(
        response.body.data.map((m: { user: { id: string } }) => [m.user.id, m]),
      );

      expect(byUser.get(member.userId)).toMatchObject({
        status: 'ACTIVE',
        openTasks: 1,
        user: { signInMethods: ['PASSWORD'], twoFactorEnabled: false },
      });
      expect(byUser.get(placeholder.id)).toMatchObject({
        status: 'NOT_SIGNED_UP',
        user: { signInMethods: [], lastActiveAt: null },
      });
      // No password hash, nor anything like one, leaves the API.
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|\$argon2/);
    });

    it('lists every team with its counts', async () => {
      const scope = await setupScope();
      await as(scope.owner)
        .post(url(`/workspaces/${scope.workspaceId}/teams`), { name: 'Leasing' })
        .expect(201);

      const response = await as(scope.owner).get(adminUrl(scope, '/teams')).expect(200);
      expect(response.body.data).toEqual([
        expect.objectContaining({ name: 'Leasing', memberCount: expect.any(Number) }),
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('invitation links', () => {
    it('issues a working link and ends the previous one', async () => {
      const scope = await setupScope();
      const invited = await as(scope.owner)
        .post(url(`/workspaces/${scope.workspaceId}/invitations`), {
          email: uniqueEmail('invitee'),
          role: WorkspaceRole.MEMBER,
        })
        .expect(201);
      const invitationId = invited.body.data.id as string;

      const first = await as(scope.owner)
        .post(adminUrl(scope, `/invitations/${invitationId}/link`))
        .expect(200);
      const second = await as(scope.owner)
        .post(adminUrl(scope, `/invitations/${invitationId}/link`))
        .expect(200);

      const tokenOf = (link: string) => link.slice(link.lastIndexOf('/') + 1);
      // One origin, even when WEB_URL lists several.
      expect(second.body.data.url).toMatch(/^https?:\/\/[^,\s]+\/invitations\/[\w-]+$/);
      await request(server())
        .get(url(`/invitations/${tokenOf(second.body.data.url)}`))
        .expect(200);
      await request(server())
        .get(url(`/invitations/${tokenOf(first.body.data.url)}`))
        .expect(404);
    });
  });
});
