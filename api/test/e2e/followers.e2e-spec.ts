import { API_PREFIX, WorkspaceRole, formatMention } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Followers (e2e)', () => {
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
    const sectionId = project.body.data.sections[0].id as string;

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'A task', sectionId })
      .expect(201);

    const ticket = await request(server())
      .post(url(`/workspaces/${workspaceId}/tickets`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Something is broken' })
      .expect(201);

    return {
      owner,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId,
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

  const taskFollowers = (scope: Scope, taskId = scope.taskId) =>
    url(`/workspaces/${scope.workspaceId}/tasks/${taskId}/followers`);
  const ticketFollowers = (scope: Scope, ref = scope.ticketKey) =>
    url(`/workspaces/${scope.workspaceId}/tickets/${ref}/followers`);

  const listIds = async (path: string, actor: Actor): Promise<string[]> => {
    const response = await request(server())
      .get(path)
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(200);

    return (response.body.data as { user: { id: string } }[]).map((row) => row.user.id);
  };

  const patchTask = (scope: Scope, actor: Actor, body: Record<string, unknown>) =>
    request(server())
      .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`))
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);

  // -------------------------------------------------------------------------
  describe('following automatically', () => {
    it('makes the creator follow a task and a ticket from the start', async () => {
      const scope = await setupScope();

      expect(await listIds(taskFollowers(scope), scope.owner)).toEqual([scope.owner.userId]);
      expect(await listIds(ticketFollowers(scope), scope.owner)).toEqual([scope.owner.userId]);
    });

    it('adds the assignee when a task is assigned', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await patchTask(scope, scope.owner, { assigneeId: ada.userId }).expect(200);

      expect(await listIds(taskFollowers(scope), scope.owner)).toEqual([
        scope.owner.userId,
        ada.userId,
      ]);
    });

    it('adds the assignee when a ticket is assigned', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await request(server())
        .patch(url(`/workspaces/${scope.workspaceId}/tickets/${scope.ticketKey}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ assigneeId: ada.userId })
        .expect(200);

      expect(await listIds(ticketFollowers(scope), scope.owner)).toContain(ada.userId);
    });

    it('adds the assignee through the shared work-item route', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      const created = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ type: 'TASK', title: 'Via the list', sectionId: scope.sectionId })
        .expect(201);
      const itemId = created.body.data.id as string;

      expect(await listIds(taskFollowers(scope, itemId), scope.owner)).toEqual([
        scope.owner.userId,
      ]);

      await request(server())
        .patch(
          url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items/${itemId}`),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ assigneeIds: [ada.userId] })
        .expect(200);

      expect(await listIds(taskFollowers(scope, itemId), scope.owner)).toEqual([
        scope.owner.userId,
        ada.userId,
      ]);
    });

    it('adds whoever comments, and whoever they mention', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      const grace = await registerUser('Grace Hopper');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      await addMember(scope, grace, WorkspaceRole.MEMBER);

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/comments`))
        .set('Authorization', `Bearer ${ada.token}`)
        .send({ body: `${formatMention(grace.userId, 'Grace Hopper')} can you look?` })
        .expect(201);

      const ids = await listIds(taskFollowers(scope), scope.owner);
      expect(ids).toEqual([scope.owner.userId, ada.userId, grace.userId]);
    });

    it('adds someone named in the description', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await patchTask(scope, scope.owner, {
        description: `<p><span data-mention="${ada.userId}">@Ada Lovelace</span> owns this</p>`,
      }).expect(200);

      expect(await listIds(taskFollowers(scope), scope.owner)).toContain(ada.userId);
    });

    it('ignores an outsider named in a comment', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/comments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: `${formatMention(stranger.userId, 'Stranger')} hi` })
        .expect(201);

      expect(await listIds(taskFollowers(scope), scope.owner)).toEqual([scope.owner.userId]);
    });
  });

  // -------------------------------------------------------------------------
  describe('adding by hand', () => {
    it('adds members and returns the new list', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      const response = await request(server())
        .post(taskFollowers(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [ada.userId] })
        .expect(201);

      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[1]).toMatchObject({
        user: { id: ada.userId, name: 'Ada Lovelace' },
      });
      expect(typeof response.body.data[1].followedAt).toBe('string');
    });

    it('refuses someone who is not a member of the workspace', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await request(server())
        .post(taskFollowers(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [stranger.userId] })
        .expect(400);

      expect(await listIds(taskFollowers(scope), scope.owner)).toEqual([scope.owner.userId]);
    });

    it('is a no-op for someone already following', async () => {
      const scope = await setupScope();

      const response = await request(server())
        .post(taskFollowers(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [scope.owner.userId] })
        .expect(201);

      expect(response.body.data).toHaveLength(1);
    });

    it('rejects an empty list', async () => {
      const scope = await setupScope();

      await request(server())
        .post(taskFollowers(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [] })
        .expect(422);
    });

    it('works on a ticket addressed by key', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await request(server())
        .post(ticketFollowers(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [ada.userId] })
        .expect(201);

      expect(await listIds(ticketFollowers(scope, scope.ticketId), scope.owner)).toContain(
        ada.userId,
      );
    });

    it('records a story on the item', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await request(server())
        .post(taskFollowers(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [ada.userId] })
        .expect(201);

      const story = await context.prisma.activityLog.findFirst({
        where: { entity: 'TASK', entityId: scope.taskId, action: 'FOLLOWED' },
      });
      expect(story).toMatchObject({
        actorId: scope.owner.userId,
        metadata: { users: [{ id: ada.userId, label: 'Ada Lovelace' }], self: false },
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('leaving and removing', () => {
    it('lets anyone leave, and re-adds them when assigned again', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      await patchTask(scope, scope.owner, { assigneeId: ada.userId }).expect(200);

      const left = await request(server())
        .delete(`${taskFollowers(scope)}/${ada.userId}`)
        .set('Authorization', `Bearer ${ada.token}`)
        .expect(200);
      expect(left.body.data.map((row: { user: { id: string } }) => row.user.id)).toEqual([
        scope.owner.userId,
      ]);

      // Unassign and assign again: the assignment is what re-subscribes them.
      await patchTask(scope, scope.owner, { assigneeId: null }).expect(200);
      await patchTask(scope, scope.owner, { assigneeId: ada.userId }).expect(200);

      expect(await listIds(taskFollowers(scope), scope.owner)).toContain(ada.userId);
    });

    it('refuses a member removing somebody else', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await request(server())
        .delete(`${taskFollowers(scope)}/${scope.owner.userId}`)
        .set('Authorization', `Bearer ${ada.token}`)
        .expect(403);

      expect(await listIds(taskFollowers(scope), scope.owner)).toContain(scope.owner.userId);
    });

    it('lets a manager remove somebody else', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      const manager = await registerUser('Manager');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      await addMember(scope, manager, WorkspaceRole.MANAGER);
      await patchTask(scope, scope.owner, { assigneeId: ada.userId }).expect(200);

      await request(server())
        .delete(`${taskFollowers(scope)}/${ada.userId}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);

      expect(await listIds(taskFollowers(scope), scope.owner)).not.toContain(ada.userId);

      const story = await context.prisma.activityLog.findFirst({
        where: { entity: 'TASK', entityId: scope.taskId, action: 'UNFOLLOWED' },
      });
      expect(story).toMatchObject({ actorId: manager.userId, metadata: { self: false } });
    });

    it('is idempotent for someone who is not following', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await request(server())
        .delete(`${taskFollowers(scope)}/${ada.userId}`)
        .set('Authorization', `Bearer ${ada.token}`)
        .expect(200);

      const stories = await context.prisma.activityLog.count({
        where: { entity: 'TASK', entityId: scope.taskId, action: 'UNFOLLOWED' },
      });
      expect(stories).toBe(0);
    });

    it('drops someone who has left the workspace', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      await patchTask(scope, scope.owner, { assigneeId: ada.userId }).expect(200);

      await context.prisma.workspaceMember.deleteMany({
        where: { workspaceId: scope.workspaceId, userId: ada.userId },
      });

      expect(await listIds(taskFollowers(scope), scope.owner)).toEqual([scope.owner.userId]);
    });
  });

  // -------------------------------------------------------------------------
  describe('comment notifications', () => {
    const inboxOf = async (scope: Scope, actor: Actor) => {
      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);

      return inbox.body.data.items as { type: string }[];
    };

    it('reach a collaborator added by hand', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await request(server())
        .post(taskFollowers(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [ada.userId] })
        .expect(201);

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/comments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'Status update' })
        .expect(201);

      const inbox = await inboxOf(scope, ada);
      expect(inbox.filter((item) => item.type === 'COMMENT_CREATED')).toHaveLength(1);
    });

    it('do not reach someone who left the task', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      await patchTask(scope, scope.owner, { assigneeId: ada.userId }).expect(200);

      await request(server())
        .delete(`${taskFollowers(scope)}/${ada.userId}`)
        .set('Authorization', `Bearer ${ada.token}`)
        .expect(200);

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/comments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'Status update' })
        .expect(201);

      const inbox = await inboxOf(scope, ada);
      expect(inbox.filter((item) => item.type === 'COMMENT_CREATED')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('tenant isolation', () => {
    it('keeps another workspace out of every route', async () => {
      const scope = await setupScope();
      const outsider = await registerUser('Outsider');

      await request(server())
        .get(taskFollowers(scope))
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
      await request(server())
        .post(taskFollowers(scope))
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ userIds: [outsider.userId] })
        .expect(403);
      await request(server())
        .delete(`${taskFollowers(scope)}/${scope.owner.userId}`)
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
      await request(server())
        .get(ticketFollowers(scope))
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
    });

    it('does not find a task from another workspace through its own route', async () => {
      const first = await setupScope();
      const second = await setupScope();

      await request(server())
        .get(url(`/workspaces/${second.workspaceId}/tasks/${first.taskId}/followers`))
        .set('Authorization', `Bearer ${second.owner.token}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      const scope = await setupScope();
      await request(server()).get(taskFollowers(scope)).expect(401);
    });
  });
});
