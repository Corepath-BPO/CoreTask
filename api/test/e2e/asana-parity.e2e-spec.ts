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
 * The Asana-parity endpoints: search, task likes and dependencies, starred
 * projects, My Tasks sections, inbox archive and bookmarks, and goals. Each
 * block proves the feature works and that it respects project privacy.
 */
describe('Asana parity (e2e)', () => {
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
    member: Actor;
    workspaceId: string;
    projectId: string;
    sectionId: string;
    privateProjectId: string;
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

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser('Ada Owner');
    const member = await registerUser('Bea Member');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(as(owner))
      .send({ name: 'Launch Plan' })
      .expect(201);

    const privateProject = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(as(owner))
      .send({ name: 'Secret Merger', visibility: 'PRIVATE' })
      .expect(201);

    return {
      owner,
      member,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: project.body.data.sections[0].id as string,
      privateProjectId: privateProject.body.data.id as string,
    };
  };

  const createTask = async (scope: Scope, actor: Actor, body: Record<string, unknown>) => {
    const response = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/tasks`))
      .set(as(actor))
      .send(body)
      .expect(201);
    return response.body.data.id as string;
  };

  describe('search', () => {
    it('finds tasks, projects and people, best match first', async () => {
      const scope = await setupScope();
      await createTask(scope, scope.owner, {
        title: 'Launch checklist',
        sectionId: scope.sectionId,
      });
      await createTask(scope, scope.owner, {
        title: 'Prelaunch survey',
        sectionId: scope.sectionId,
      });

      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/search`))
        .query({ q: 'launch' })
        .set(as(scope.owner))
        .expect(200);

      const data = response.body.data;
      expect(data.tasks.map((hit: { title: string }) => hit.title)).toEqual([
        'Launch checklist',
        'Prelaunch survey',
      ]);
      expect(data.projects.map((hit: { name: string }) => hit.name)).toContain('Launch Plan');

      const people = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/search`))
        .query({ q: 'bea', types: 'people' })
        .set(as(scope.owner))
        .expect(200);
      expect(people.body.data.people.map((hit: { name: string }) => hit.name)).toEqual([
        'Bea Member',
      ]);
      expect(people.body.data.tasks).toEqual([]);
    });

    it('never surfaces a private project, or its tasks, to someone not on it', async () => {
      const scope = await setupScope();
      await createTask(scope, scope.owner, {
        title: 'Secret term sheet',
        projectId: scope.privateProjectId,
      });

      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/search`))
        .query({ q: 'secret' })
        .set(as(scope.member))
        .expect(200);

      expect(response.body.data.tasks).toEqual([]);
      expect(response.body.data.projects).toEqual([]);
    });

    it('refuses an empty query', async () => {
      const scope = await setupScope();
      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/search`))
        .query({ q: '' })
        .set(as(scope.owner))
        .expect(422);
    });
  });

  describe('task likes and dependencies', () => {
    it('counts likes per person, idempotently', async () => {
      const scope = await setupScope();
      const taskId = await createTask(scope, scope.owner, {
        title: 'Ship it',
        sectionId: scope.sectionId,
      });
      const likes = url(`/workspaces/${scope.workspaceId}/tasks/${taskId}/likes`);

      await request(server()).post(likes).set(as(scope.owner)).expect(200);
      await request(server()).post(likes).set(as(scope.owner)).expect(200);
      const both = await request(server()).post(likes).set(as(scope.member)).expect(200);
      expect(both.body.data).toMatchObject({ count: 2, likedByMe: true });

      const after = await request(server()).delete(likes).set(as(scope.owner)).expect(200);
      expect(after.body.data).toMatchObject({ count: 1, likedByMe: false });
    });

    it('records an edge on both ends and refuses loops and self-dependencies', async () => {
      const scope = await setupScope();
      const design = await createTask(scope, scope.owner, {
        title: 'Design',
        sectionId: scope.sectionId,
      });
      const build = await createTask(scope, scope.owner, {
        title: 'Build',
        sectionId: scope.sectionId,
      });
      const deps = (taskId: string) =>
        url(`/workspaces/${scope.workspaceId}/tasks/${taskId}/dependencies`);

      const added = await request(server())
        .post(deps(build))
        .set(as(scope.member))
        .send({ taskId: design, direction: 'BLOCKED_BY' })
        .expect(201);
      expect(added.body.data.blockedBy.map((entry: { id: string }) => entry.id)).toEqual([design]);

      const farEnd = await request(server()).get(deps(design)).set(as(scope.owner)).expect(200);
      expect(farEnd.body.data.blocking.map((entry: { id: string }) => entry.id)).toEqual([build]);

      await request(server())
        .post(deps(design))
        .set(as(scope.owner))
        .send({ taskId: build, direction: 'BLOCKED_BY' })
        .expect(400);
      await request(server())
        .post(deps(design))
        .set(as(scope.owner))
        .send({ taskId: design, direction: 'BLOCKING' })
        .expect(400);

      const dependencyId = added.body.data.blockedBy[0].dependencyId as string;
      const removed = await request(server())
        .delete(`${deps(design)}/${dependencyId}`)
        .set(as(scope.owner))
        .expect(200);
      expect(removed.body.data.blocking).toEqual([]);
    });
  });

  describe('starred projects', () => {
    it('stars and unstars per person, and hides private projects from outsiders', async () => {
      const scope = await setupScope();
      const star = (projectId: string) =>
        url(`/workspaces/${scope.workspaceId}/projects/${projectId}/star`);

      const starred = await request(server())
        .put(star(scope.projectId))
        .set(as(scope.member))
        .expect(200);
      expect(starred.body.data.map((project: { name: string }) => project.name)).toEqual([
        'Launch Plan',
      ]);

      const ownerList = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/starred-projects`))
        .set(as(scope.owner))
        .expect(200);
      expect(ownerList.body.data).toEqual([]);

      await request(server()).put(star(scope.privateProjectId)).set(as(scope.member)).expect(404);

      const after = await request(server())
        .delete(star(scope.projectId))
        .set(as(scope.member))
        .expect(200);
      expect(after.body.data).toEqual([]);
    });
  });

  describe('My Tasks sections', () => {
    it('stores a placement, Recently assigned included, with when it was made', async () => {
      const scope = await setupScope();
      const taskId = await createTask(scope, scope.owner, {
        title: 'Plan',
        assigneeId: scope.owner.userId,
      });
      const placements = url(`/workspaces/${scope.workspaceId}/my-tasks/placements`);

      await request(server())
        .put(`${placements}/${taskId}`)
        .set(as(scope.owner))
        .send({ bucket: 'TODAY' })
        .expect(200);
      const listed = await request(server()).get(placements).set(as(scope.owner)).expect(200);
      expect(listed.body.data).toEqual([{ taskId, bucket: 'TODAY', placedAt: expect.any(String) }]);

      // Personal: the other member's list is untouched.
      const theirs = await request(server()).get(placements).set(as(scope.member)).expect(200);
      expect(theirs.body.data).toEqual([]);

      await request(server())
        .put(`${placements}/${taskId}`)
        .set(as(scope.owner))
        .send({ bucket: 'RECENTLY_ASSIGNED' })
        .expect(200);
      // Kept as a row: a move made today outranks the auto-sort rules.
      const back = await request(server()).get(placements).set(as(scope.owner)).expect(200);
      expect(back.body.data).toEqual([
        { taskId, bucket: 'RECENTLY_ASSIGNED', placedAt: expect.any(String) },
      ]);

      // The auto-sort rules: Do today on by default, one at a time to change.
      const rules = url(`/workspaces/${scope.workspaceId}/my-tasks/rules`);
      expect(
        (await request(server()).get(rules).set(as(scope.owner)).expect(200)).body.data,
      ).toEqual({ dueToday: true, dueThisWeek: false });
      const changed = await request(server())
        .put(rules)
        .set(as(scope.owner))
        .send({ dueThisWeek: true })
        .expect(200);
      expect(changed.body.data).toEqual({ dueToday: true, dueThisWeek: true });
      // Personal again.
      expect(
        (await request(server()).get(rules).set(as(scope.member)).expect(200)).body.data,
      ).toEqual({ dueToday: true, dueThisWeek: false });
      await request(server()).put(rules).set(as(scope.owner)).send({ dueToday: 'yes' }).expect(422);
    });
  });

  describe('inbox archive and bookmarks', () => {
    it('archives out of the inbox, reads it, and keeps bookmarks findable', async () => {
      const scope = await setupScope();
      const base = url(`/workspaces/${scope.workspaceId}/notifications`);
      // Creating the workspace already greets the owner, so measure from there.
      const before = await request(server()).get(base).set(as(scope.owner)).expect(200);
      const baseline = before.body.data.unreadCount as number;
      const notification = await context.prisma.notification.create({
        data: {
          userId: scope.owner.userId,
          workspaceId: scope.workspaceId,
          type: 'MENTIONED',
          title: 'Bea mentioned you',
        },
      });
      const ids = (body: { data: { items: { id: string }[] } }) =>
        body.data.items.map((item) => item.id);

      await request(server())
        .post(`${base}/${notification.id}/bookmark`)
        .set(as(scope.owner))
        .expect(200);
      const archived = await request(server())
        .post(`${base}/archive`)
        .set(as(scope.owner))
        .send({ notificationIds: [notification.id] })
        .expect(200);
      expect(archived.body.data).toMatchObject({ updated: 1, unreadCount: baseline });

      const inbox = await request(server()).get(base).set(as(scope.owner)).expect(200);
      expect(ids(inbox.body)).not.toContain(notification.id);

      const archive = await request(server())
        .get(base)
        .query({ view: 'archived' })
        .set(as(scope.owner))
        .expect(200);
      expect(ids(archive.body)).toEqual([notification.id]);

      const bookmarks = await request(server())
        .get(base)
        .query({ view: 'bookmarked' })
        .set(as(scope.owner))
        .expect(200);
      expect(bookmarks.body.data.items[0]).toMatchObject({ id: notification.id });

      await request(server())
        .post(`${base}/${notification.id}/unarchive`)
        .set(as(scope.owner))
        .expect(200);
      const back = await request(server()).get(base).set(as(scope.owner)).expect(200);
      expect(ids(back.body)).toContain(notification.id);
      // It comes back read: the reader already saw it before filing it away.
      expect(back.body.data.unreadCount).toBe(baseline);
    });
  });

  describe('goals', () => {
    it('rolls progress up from projects through sub-goals, and refuses loops', async () => {
      const scope = await setupScope();
      await createTask(scope, scope.owner, {
        title: 'One',
        sectionId: scope.sectionId,
        status: 'DONE',
      });
      await createTask(scope, scope.owner, { title: 'Two', sectionId: scope.sectionId });
      const goals = url(`/workspaces/${scope.workspaceId}/goals`);

      const company = await request(server())
        .post(goals)
        .set(as(scope.owner))
        .send({ name: 'Win the market', progressSource: 'SUB_GOALS' })
        .expect(201);
      const companyId = company.body.data.id as string;

      const team = await request(server())
        .post(goals)
        .set(as(scope.member))
        .send({ name: 'Ship the launch', parentId: companyId, progressSource: 'PROJECTS' })
        .expect(201);
      const teamId = team.body.data.id as string;
      expect(team.body.data.owner.id).toBe(scope.member.userId);

      const linked = await request(server())
        .put(`${goals}/${teamId}/projects/${scope.projectId}`)
        .set(as(scope.member))
        .expect(200);
      expect(linked.body.data.progress).toBe(50);

      const list = await request(server()).get(goals).set(as(scope.owner)).expect(200);
      const byId = new Map(
        list.body.data.map((goal: { id: string; progress: number }) => [goal.id, goal]),
      );
      expect((byId.get(companyId) as { progress: number }).progress).toBe(50);

      await request(server())
        .patch(`${goals}/${companyId}`)
        .set(as(scope.owner))
        .send({ parentId: teamId })
        .expect(400);
    });

    it('moves sub-goals up when their parent is deleted, and guards who may delete', async () => {
      const scope = await setupScope();
      const goals = url(`/workspaces/${scope.workspaceId}/goals`);
      const parent = await request(server())
        .post(goals)
        .set(as(scope.owner))
        .send({ name: 'Parent' })
        .expect(201);
      const child = await request(server())
        .post(goals)
        .set(as(scope.owner))
        .send({ name: 'Child', parentId: parent.body.data.id })
        .expect(201);

      // Bea neither owns nor created it, and is not a manager.
      await request(server())
        .delete(`${goals}/${parent.body.data.id}`)
        .set(as(scope.member))
        .expect(403);
      await request(server())
        .delete(`${goals}/${parent.body.data.id}`)
        .set(as(scope.owner))
        .expect(204);

      const list = await request(server()).get(goals).set(as(scope.owner)).expect(200);
      expect(list.body.data).toEqual([
        expect.objectContaining({ id: child.body.data.id, parentId: null }),
      ]);
    });
  });
});
