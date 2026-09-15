import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import { RealtimeGateway } from '../../src/websocket/realtime.gateway';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Project privacy and membership.
 *
 * A PRIVATE project must look like it does not exist to anyone who is neither
 * on its roster nor a workspace admin — over the project routes, the
 * workspace-wide task and ticket lists, the activity feed and the socket room.
 * Members act with their project role's cap; project admins manage the roster.
 */
describe('Project members and privacy (e2e)', () => {
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

  const auth = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  const createProject = async (workspaceId: string, actor: Actor, body: object = {}) => {
    const response = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(auth(actor))
      .send({ name: 'Leadership Planning', ...body })
      .expect(201);

    return response.body.data;
  };

  const projectUrl = (workspaceId: string, projectId: string) =>
    `/workspaces/${workspaceId}/projects/${projectId}`;

  const addProjectMember = (
    workspaceId: string,
    projectId: string,
    actor: Actor,
    userId: string,
    role?: string,
  ) =>
    request(server())
      .post(url(`${projectUrl(workspaceId, projectId)}/members`))
      .set(auth(actor))
      .send(role ? { userId, role } : { userId });

  const listMembers = async (workspaceId: string, projectId: string, actor: Actor) => {
    const response = await request(server())
      .get(url(`${projectUrl(workspaceId, projectId)}/members`))
      .set(auth(actor))
      .expect(200);
    return response.body.data as { userId: string; role: string }[];
  };

  const roleOf = async (workspaceId: string, projectId: string, actor: Actor, userId: string) =>
    (await listMembers(workspaceId, projectId, actor)).find((m) => m.userId === userId)?.role;

  /**
   * The cast every test starts from: a workspace with one of each role, and a
   * private project the owner created. Nobody else is on its roster yet.
   */
  const setup = async () => {
    const owner = await registerUser('Owner');
    const admin = await registerUser('Admin');
    const manager = await registerUser('Manager');
    const member = await registerUser('Member');
    const guest = await registerUser('Guest');
    const workspaceId = await createWorkspace(owner);
    await addMember(workspaceId, admin, WorkspaceRole.ADMIN);
    await addMember(workspaceId, manager, WorkspaceRole.MANAGER);
    await addMember(workspaceId, member, WorkspaceRole.MEMBER);
    await addMember(workspaceId, guest, WorkspaceRole.GUEST);
    const project = await createProject(workspaceId, owner, { visibility: 'PRIVATE' });

    return { owner, admin, manager, member, guest, workspaceId, project };
  };

  describe('the roster on creation', () => {
    it('makes the creator a project admin and defaults to PUBLIC', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);

      const project = await createProject(workspaceId, owner);

      expect(project).toMatchObject({
        visibility: 'PUBLIC',
        memberCount: 1,
        access: { effectiveRole: 'OWNER', projectRole: 'ADMIN', isMember: true, canManage: true },
      });
      expect(project.members).toEqual([
        expect.objectContaining({
          role: 'ADMIN',
          user: expect.objectContaining({ id: owner.userId }),
        }),
      ]);
    });

    it('makes a named lead an admin too, on create and on update', async () => {
      const { owner, member, manager, workspaceId } = await setup();

      const created = await createProject(workspaceId, owner, {
        name: 'Led',
        leadId: member.userId,
      });
      expect(await roleOf(workspaceId, created.id, owner, member.userId)).toBe('ADMIN');

      await request(server())
        .patch(url(projectUrl(workspaceId, created.id)))
        .set(auth(owner))
        .send({ leadId: manager.userId })
        .expect(200);
      expect(await roleOf(workspaceId, created.id, owner, manager.userId)).toBe('ADMIN');
    });

    it('never demotes an existing member by naming them lead', async () => {
      const { owner, member, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'VIEWER').expect(201);

      await request(server())
        .patch(url(projectUrl(workspaceId, project.id)))
        .set(auth(owner))
        .send({ leadId: member.userId })
        .expect(200);

      expect(await roleOf(workspaceId, project.id, owner, member.userId)).toBe('VIEWER');
    });
  });

  describe('who can see a private project', () => {
    it('does not exist for a workspace member who is not on the roster', async () => {
      const { manager, member, guest, workspaceId, project } = await setup();

      for (const outsider of [manager, member, guest]) {
        const detail = await request(server())
          .get(url(projectUrl(workspaceId, project.id)))
          .set(auth(outsider))
          .expect(404);
        expect(detail.body.error.code).toBe('RESOURCE_NOT_FOUND');

        const list = await request(server())
          .get(url(`/workspaces/${workspaceId}/projects`))
          .set(auth(outsider))
          .expect(200);
        expect(list.body.data).toEqual([]);
        expect(list.body.meta.total).toBe(0);
      }
    });

    it('is visible to a member, capped by their project role', async () => {
      const { owner, manager, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, manager.userId, 'VIEWER').expect(201);

      const response = await request(server())
        .get(url(projectUrl(workspaceId, project.id)))
        .set(auth(manager))
        .expect(200);

      expect(response.body.data).toMatchObject({
        visibility: 'PRIVATE',
        memberCount: 2,
        access: { effectiveRole: 'GUEST', projectRole: 'VIEWER', isMember: true, canManage: false },
      });
    });

    it('is visible to workspace OWNER and ADMIN without a membership', async () => {
      const { admin, workspaceId, project } = await setup();

      const response = await request(server())
        .get(url(projectUrl(workspaceId, project.id)))
        .set(auth(admin))
        .expect(200);

      expect(response.body.data.access).toEqual({
        effectiveRole: 'ADMIN',
        projectRole: null,
        isMember: false,
        canManage: true,
      });

      const list = await request(server())
        .get(url(`/workspaces/${workspaceId}/projects`))
        .set(auth(admin))
        .expect(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([project.id]);
    });

    it('refuses the socket room to a non-member and admits a member or an admin', async () => {
      const { owner, admin, member, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'VIEWER').expect(201);
      const outsider = await registerUser('Outsider');
      await addMember(workspaceId, outsider, WorkspaceRole.MANAGER);

      const gateway = context.app.get(RealtimeGateway);
      const stub = (userId: string) =>
        ({ data: { userId }, emit: jest.fn(), join: jest.fn() }) as never;

      await expect(
        gateway.onProjectJoin(stub(outsider.userId), { projectId: project.id }),
      ).resolves.toEqual({
        joined: false,
      });
      await expect(
        gateway.onProjectJoin(stub(member.userId), { projectId: project.id }),
      ).resolves.toEqual({
        joined: true,
      });
      await expect(
        gateway.onProjectJoin(stub(admin.userId), { projectId: project.id }),
      ).resolves.toEqual({
        joined: true,
      });
    });
  });

  describe('what a project role allows', () => {
    it('lets a VIEWER read but not edit the project or its sections', async () => {
      const { owner, manager, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, manager.userId, 'VIEWER').expect(201);

      await request(server())
        .get(url(`${projectUrl(workspaceId, project.id)}/sections`))
        .set(auth(manager))
        .expect(200);

      const rename = await request(server())
        .patch(url(projectUrl(workspaceId, project.id)))
        .set(auth(manager))
        .send({ name: 'Renamed' })
        .expect(403);
      expect(rename.body.error.code).toBe('INSUFFICIENT_PROJECT_ROLE');

      const section = await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/sections`))
        .set(auth(manager))
        .send({ name: 'Later' })
        .expect(403);
      expect(section.body.error.code).toBe('INSUFFICIENT_PROJECT_ROLE');
    });

    it('lets an EDITOR work but not manage the roster', async () => {
      const { owner, manager, guest, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, manager.userId, 'EDITOR').expect(201);

      await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/sections`))
        .set(auth(manager))
        .send({ name: 'Later' })
        .expect(201);

      const denied = await addProjectMember(workspaceId, project.id, manager, guest.userId).expect(
        403,
      );
      expect(denied.body.error.code).toBe('INSUFFICIENT_PROJECT_ROLE');

      // A manager in the workspace, but an editor here: archiving needs MANAGER.
      const archive = await request(server())
        .delete(url(projectUrl(workspaceId, project.id)))
        .set(auth(manager))
        .expect(403);
      expect(archive.body.error.code).toBe('INSUFFICIENT_PROJECT_ROLE');
    });

    it('lets a project ADMIN with a MEMBER workspace role manage the roster', async () => {
      const { owner, member, guest, manager, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'ADMIN').expect(201);

      await addProjectMember(workspaceId, project.id, member, guest.userId, 'VIEWER').expect(201);
      await request(server())
        .patch(url(`${projectUrl(workspaceId, project.id)}/members/${guest.userId}`))
        .set(auth(member))
        .send({ role: 'EDITOR' })
        .expect(200);
      expect(await roleOf(workspaceId, project.id, member, guest.userId)).toBe('EDITOR');

      await request(server())
        .delete(url(`${projectUrl(workspaceId, project.id)}/members/${guest.userId}`))
        .set(auth(member))
        .expect(200);
      expect(await roleOf(workspaceId, project.id, member, guest.userId)).toBeUndefined();

      // But not archive: a project role never raises the workspace role, so
      // the workspace guard refuses before the project is even looked at.
      const archive = await request(server())
        .delete(url(projectUrl(workspaceId, project.id)))
        .set(auth(member))
        .expect(403);
      expect(archive.body.error.code).toBe('INSUFFICIENT_WORKSPACE_ROLE');
      void manager;
    });

    it('refuses to add someone who is not in the workspace', async () => {
      const { owner, workspaceId, project } = await setup();
      const stranger = await registerUser('Stranger');

      const denied = await addProjectMember(workspaceId, project.id, owner, stranger.userId).expect(
        400,
      );
      expect(denied.body.error.code).toBe('BAD_REQUEST');
    });

    it('leaves an existing member’s role alone when added again', async () => {
      const { owner, member, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'ADMIN').expect(201);
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'VIEWER').expect(201);

      expect(await roleOf(workspaceId, project.id, owner, member.userId)).toBe('ADMIN');
    });
  });

  describe('the last admin of a private project', () => {
    it('cannot be demoted, removed, or leave', async () => {
      const { owner, workspaceId, project } = await setup();

      const demote = await request(server())
        .patch(url(`${projectUrl(workspaceId, project.id)}/members/${owner.userId}`))
        .set(auth(owner))
        .send({ role: 'EDITOR' })
        .expect(409);
      expect(demote.body.error.code).toBe('LAST_PROJECT_ADMIN');

      await request(server())
        .delete(url(`${projectUrl(workspaceId, project.id)}/members/${owner.userId}`))
        .set(auth(owner))
        .expect(409);

      await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/leave`))
        .set(auth(owner))
        .expect(409);
    });

    it('may go once someone else is an admin', async () => {
      const { owner, member, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'ADMIN').expect(201);

      await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/leave`))
        .set(auth(owner))
        .expect(200)
        .expect(({ body }) => expect(body.data).toEqual({ left: true }));

      // The owner still reaches it through the override, off the roster.
      const detail = await request(server())
        .get(url(projectUrl(workspaceId, project.id)))
        .set(auth(owner))
        .expect(200);
      expect(detail.body.data.access).toMatchObject({ isMember: false, canManage: true });
    });

    it('is not a rule on a public project', async () => {
      const owner = await registerUser();
      const workspaceId = await createWorkspace(owner);
      const project = await createProject(workspaceId, owner, { visibility: 'PUBLIC' });

      await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/leave`))
        .set(auth(owner))
        .expect(200);
      expect(await listMembers(workspaceId, project.id, owner)).toEqual([]);
    });
  });

  describe('joining and leaving', () => {
    it('lets anyone join a public project as an editor, and a guest as a viewer', async () => {
      const { owner, member, guest, workspaceId } = await setup();
      const project = await createProject(workspaceId, owner, {
        name: 'Open',
        visibility: 'PUBLIC',
      });

      const joined = await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/join`))
        .set(auth(member))
        .expect(200);
      expect(joined.body.data).toMatchObject({ userId: member.userId, role: 'EDITOR' });

      // Twice is once.
      await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/join`))
        .set(auth(member))
        .expect(200);
      expect((await listMembers(workspaceId, project.id, owner)).length).toBe(2);

      const asGuest = await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/join`))
        .set(auth(guest))
        .expect(200);
      expect(asGuest.body.data.role).toBe('VIEWER');
    });

    it('cannot join a private project it cannot see', async () => {
      const { member, workspaceId, project } = await setup();

      await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/join`))
        .set(auth(member))
        .expect(404);
    });

    it('lets a member leave and then no longer see the private project', async () => {
      const { owner, member, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'EDITOR').expect(201);

      await request(server())
        .post(url(`${projectUrl(workspaceId, project.id)}/leave`))
        .set(auth(member))
        .expect(200);

      await request(server())
        .get(url(projectUrl(workspaceId, project.id)))
        .set(auth(member))
        .expect(404);
    });

    it('drops project memberships when someone is removed from the workspace', async () => {
      const { owner, member, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'EDITOR').expect(201);
      const membership = await context.prisma.workspaceMember.findUniqueOrThrow({
        where: { workspaceId_userId: { workspaceId, userId: member.userId } },
      });

      await request(server())
        .delete(url(`/workspaces/${workspaceId}/members/${membership.id}`))
        .set(auth(owner))
        .expect(200);

      expect(await roleOf(workspaceId, project.id, owner, member.userId)).toBeUndefined();
    });
  });

  describe('changing visibility', () => {
    it('needs a project admin, and puts a non-member workspace admin on the roster', async () => {
      const { owner, admin, member, workspaceId } = await setup();
      const project = await createProject(workspaceId, owner, {
        name: 'Open',
        visibility: 'PUBLIC',
      });
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'EDITOR').expect(201);

      const denied = await request(server())
        .patch(url(projectUrl(workspaceId, project.id)))
        .set(auth(member))
        .send({ visibility: 'PRIVATE' })
        .expect(403);
      expect(denied.body.error.code).toBe('INSUFFICIENT_PROJECT_ROLE');

      const flipped = await request(server())
        .patch(url(projectUrl(workspaceId, project.id)))
        .set(auth(admin))
        .send({ visibility: 'PRIVATE' })
        .expect(200);
      expect(flipped.body.data).toMatchObject({
        visibility: 'PRIVATE',
        access: { isMember: true, projectRole: 'ADMIN' },
      });
    });

    it('hides the project from everyone else the moment it goes private', async () => {
      const { owner, member, workspaceId } = await setup();
      const project = await createProject(workspaceId, owner, {
        name: 'Open',
        visibility: 'PUBLIC',
      });

      await request(server())
        .get(url(projectUrl(workspaceId, project.id)))
        .set(auth(member))
        .expect(200);

      await request(server())
        .patch(url(projectUrl(workspaceId, project.id)))
        .set(auth(owner))
        .send({ visibility: 'PRIVATE' })
        .expect(200);

      await request(server())
        .get(url(projectUrl(workspaceId, project.id)))
        .set(auth(member))
        .expect(404);
    });
  });

  describe('work inside a private project', () => {
    const createTask = (workspaceId: string, actor: Actor, body: object) =>
      request(server())
        .post(url(`/workspaces/${workspaceId}/tasks`))
        .set(auth(actor))
        .send(body);

    it('keeps its tasks out of the workspace list, the rollup and the detail route', async () => {
      const { owner, member, workspaceId, project } = await setup();
      const task = await createTask(workspaceId, owner, {
        title: 'Hiring plan',
        projectId: project.id,
      }).expect(201);
      await createTask(workspaceId, owner, { title: 'Workspace-level chore' }).expect(201);

      const list = await request(server())
        .get(url(`/workspaces/${workspaceId}/tasks`))
        .set(auth(member))
        .expect(200);
      expect(list.body.data.map((t: { title: string }) => t.title)).toEqual([
        'Workspace-level chore',
      ]);
      expect(list.body.meta.summary.total).toBe(1);

      await request(server())
        .get(url(`/workspaces/${workspaceId}/tasks/${task.body.data.id}`))
        .set(auth(member))
        .expect(404);

      const asOwner = await request(server())
        .get(url(`/workspaces/${workspaceId}/tasks`))
        .set(auth(owner))
        .expect(200);
      expect(asOwner.body.meta.summary.total).toBe(2);
    });

    it('refuses to create work in it for a non-member, and caps a viewer', async () => {
      const { owner, member, manager, workspaceId, project } = await setup();
      await addProjectMember(workspaceId, project.id, owner, manager.userId, 'VIEWER').expect(201);

      await createTask(workspaceId, member, { title: 'Sneak', projectId: project.id }).expect(404);

      const denied = await createTask(workspaceId, manager, {
        title: 'Read-only',
        projectId: project.id,
      }).expect(403);
      expect(denied.body.error.code).toBe('INSUFFICIENT_PROJECT_ROLE');

      const task = await createTask(workspaceId, owner, {
        title: 'Hiring plan',
        projectId: project.id,
      }).expect(201);
      const edit = await request(server())
        .patch(url(`/workspaces/${workspaceId}/tasks/${task.body.data.id}`))
        .set(auth(manager))
        .send({ title: 'Renamed' })
        .expect(403);
      expect(edit.body.error.code).toBe('INSUFFICIENT_PROJECT_ROLE');
    });

    it('refuses an assignee who cannot see the project', async () => {
      const { owner, member, workspaceId, project } = await setup();

      const denied = await createTask(workspaceId, owner, {
        title: 'Hiring plan',
        projectId: project.id,
        assigneeId: member.userId,
      }).expect(400);
      expect(denied.body.error.message).toContain('able to see');
    });

    it('keeps its tickets out of the queue and its key lookup', async () => {
      const { owner, member, workspaceId, project } = await setup();
      const ticket = await request(server())
        .post(url(`/workspaces/${workspaceId}/tickets`))
        .set(auth(owner))
        .send({ title: 'Budget', projectId: project.id })
        .expect(201);

      const list = await request(server())
        .get(url(`/workspaces/${workspaceId}/tickets`))
        .set(auth(member))
        .expect(200);
      expect(list.body.data).toEqual([]);
      expect(list.body.meta.summary.total).toBe(0);

      await request(server())
        .get(url(`/workspaces/${workspaceId}/tickets/${ticket.body.data.key}`))
        .set(auth(member))
        .expect(404);

      await request(server())
        .post(url(`/workspaces/${workspaceId}/tickets`))
        .set(auth(member))
        .send({ title: 'Sneak', projectId: project.id })
        .expect(404);
    });

    it('keeps its stories out of the workspace activity feed', async () => {
      const { owner, member, workspaceId, project } = await setup();
      await createTask(workspaceId, owner, { title: 'Hiring plan', projectId: project.id }).expect(
        201,
      );

      const feed = await request(server())
        .get(url(`/workspaces/${workspaceId}/activity`))
        .set(auth(member))
        .expect(200);
      const summaries = feed.body.data.map((entry: { summary: string }) => entry.summary);
      expect(summaries.some((s: string) => s.includes('Hiring plan'))).toBe(false);
      expect(summaries.some((s: string) => s.includes('Leadership Planning'))).toBe(false);

      const asOwner = await request(server())
        .get(url(`/workspaces/${workspaceId}/activity`))
        .set(auth(owner))
        .expect(200);
      expect(
        asOwner.body.data.some((entry: { summary: string }) =>
          entry.summary.includes('Hiring plan'),
        ),
      ).toBe(true);
    });

    it('does not notify a non-member who is mentioned in it', async () => {
      const { owner, member, workspaceId, project } = await setup();

      await createTask(workspaceId, owner, {
        title: 'Hiring plan',
        projectId: project.id,
        description: `<p><span data-mention="${member.userId}">@Member</span> please review</p>`,
      }).expect(201);

      const inbox = await request(server())
        .get(url(`/workspaces/${workspaceId}/notifications`))
        .set(auth(member))
        .expect(200);
      expect(inbox.body.data.items).toEqual([]);

      // The same mention reaches a member: the filter is about visibility, not mentions.
      await addProjectMember(workspaceId, project.id, owner, member.userId, 'VIEWER').expect(201);
      await createTask(workspaceId, owner, {
        title: 'Offer letters',
        projectId: project.id,
        description: `<p><span data-mention="${member.userId}">@Member</span> sign off</p>`,
      }).expect(201);

      const later = await request(server())
        .get(url(`/workspaces/${workspaceId}/notifications`))
        .set(auth(member))
        .expect(200);
      expect(
        later.body.data.items.some((item: { type: string }) => item.type === 'MENTIONED'),
      ).toBe(true);
    });
  });
});
