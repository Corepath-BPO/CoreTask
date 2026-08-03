import {
  API_PREFIX,
  BOARD_TASK_LIMIT,
  TaskPriority,
  TaskStatus,
  WorkspaceRole,
} from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Tasks (e2e)', () => {
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
    sections: { id: string; name: string }[];
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

    return {
      owner,
      workspaceId,
      projectId: project.body.data.id as string,
      sections: project.body.data.sections,
    };
  };

  const tasksUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/tasks`);

  const createTask = async (scope: Scope, body: object = {}, actor: Actor = scope.owner) => {
    const response = await request(server())
      .post(tasksUrl(scope))
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ title: 'A task', sectionId: scope.sections[0]!.id, ...body })
      .expect(201);

    return response.body.data;
  };

  const listTitles = async (scope: Scope, query = ''): Promise<string[]> => {
    const response = await request(server())
      .get(`${tasksUrl(scope)}${query}`)
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .expect(200);

    return response.body.data.map((task: { title: string }) => task.title);
  };

  describe('creation', () => {
    it('creates a task in a section and infers its project', async () => {
      const scope = await setupScope();

      const response = await request(server())
        .post(tasksUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Wire the endpoints', sectionId: scope.sections[0]!.id })
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        data: {
          title: 'Wire the endpoints',
          sectionId: scope.sections[0]!.id,
          projectId: scope.projectId,
          status: TaskStatus.TODO,
          priority: TaskPriority.NONE,
          completedAt: null,
          archivedAt: null,
          subtaskCount: 0,
        },
      });
      expect(response.body.data.createdById).toBe(scope.owner.userId);
    });

    it('creates a task with no project at all', async () => {
      const scope = await setupScope();
      const task = await createTask(scope, { sectionId: null, title: 'Loose task' });

      expect(task.projectId).toBeNull();
      expect(task.sectionId).toBeNull();
    });

    it('stamps completedAt when created as DONE', async () => {
      const scope = await setupScope();
      const task = await createTask(scope, { status: TaskStatus.DONE });
      expect(task.completedAt).not.toBeNull();
    });

    it('appends to the end of the column by default', async () => {
      const scope = await setupScope();
      await createTask(scope, { title: 'First' });
      await createTask(scope, { title: 'Second' });
      await createTask(scope, { title: 'Third' });

      expect(await listTitles(scope)).toEqual(['First', 'Second', 'Third']);
    });

    it('inserts after a named sibling', async () => {
      const scope = await setupScope();
      const first = await createTask(scope, { title: 'First' });
      await createTask(scope, { title: 'Third' });
      await createTask(scope, { title: 'Second', afterTaskId: first.id });

      expect(await listTitles(scope)).toEqual(['First', 'Second', 'Third']);
    });

    it('places a task first when afterTaskId is null', async () => {
      const scope = await setupScope();
      await createTask(scope, { title: 'Second' });
      await createTask(scope, { title: 'First', afterTaskId: null });

      expect(await listTitles(scope)).toEqual(['First', 'Second']);
    });

    it('rejects a section that belongs to a different project', async () => {
      const scope = await setupScope();

      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Second Project' })
        .expect(201);

      const response = await request(server())
        .post(tasksUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          title: 'Mismatched',
          projectId: scope.projectId,
          sectionId: other.body.data.sections[0].id,
        })
        .expect(400);

      expect(response.body.error.message).toMatch(/does not belong to the given project/i);
    });

    it('rejects an assignee who is not a workspace member', async () => {
      const scope = await setupScope();
      const outsider = await registerUser('Outsider');

      const response = await request(server())
        .post(tasksUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Leaky', assigneeId: outsider.userId })
        .expect(400);

      expect(response.body.error.message).toMatch(/workspace member/i);
    });

    it('rejects a blank title', async () => {
      const scope = await setupScope();

      await request(server())
        .post(tasksUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: '   ' })
        .expect(422);
    });
  });

  describe('subtasks', () => {
    it('creates a subtask and counts it on the parent', async () => {
      const scope = await setupScope();
      const parent = await createTask(scope, { title: 'Parent' });
      await createTask(scope, { title: 'Child', parentTaskId: parent.id });

      const detail = await request(server())
        .get(`${tasksUrl(scope)}/${parent.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(detail.body.data.subtaskCount).toBe(1);
      expect(detail.body.data.subtasks).toHaveLength(1);
      expect(detail.body.data.subtasks[0].title).toBe('Child');
    });

    it('counts completed subtasks separately', async () => {
      const scope = await setupScope();
      const parent = await createTask(scope, { title: 'Parent' });
      await createTask(scope, {
        title: 'Done child',
        parentTaskId: parent.id,
        status: TaskStatus.DONE,
      });
      await createTask(scope, { title: 'Open child', parentTaskId: parent.id });

      const detail = await request(server())
        .get(`${tasksUrl(scope)}/${parent.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(detail.body.data.subtaskCount).toBe(2);
      expect(detail.body.data.completedSubtaskCount).toBe(1);
    });

    it('excludes subtasks from the list by default', async () => {
      const scope = await setupScope();
      const parent = await createTask(scope, { title: 'Parent' });
      await createTask(scope, { title: 'Child', parentTaskId: parent.id });

      expect(await listTitles(scope)).toEqual(['Parent']);
      expect((await listTitles(scope, '?includeSubtasks=true')).sort()).toEqual([
        'Child',
        'Parent',
      ]);
    });

    it('refuses to nest more than one level deep', async () => {
      const scope = await setupScope();
      const parent = await createTask(scope, { title: 'Parent' });
      const child = await createTask(scope, { title: 'Child', parentTaskId: parent.id });

      const response = await request(server())
        .post(tasksUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Grandchild', parentTaskId: child.id })
        .expect(400);

      expect(response.body.error.message).toMatch(/cannot have its own subtasks/i);
    });
  });

  describe('listing and filtering', () => {
    it('returns a rollup over the whole filter, not just the page', async () => {
      const scope = await setupScope();
      await createTask(scope, { title: 'Done one', status: TaskStatus.DONE });
      await createTask(scope, { title: 'Open one' });
      await createTask(scope, { title: 'Overdue', dueDate: '2020-01-01T00:00:00.000Z' });

      const response = await request(server())
        .get(`${tasksUrl(scope)}?limit=1`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.summary).toEqual({
        total: 3,
        completed: 1,
        overdue: 1,
        unassigned: 3,
      });
    });

    it('does not count a completed task as overdue', async () => {
      const scope = await setupScope();
      await createTask(scope, {
        title: 'Late but done',
        status: TaskStatus.DONE,
        dueDate: '2020-01-01T00:00:00.000Z',
      });

      const response = await request(server())
        .get(tasksUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.meta.summary.overdue).toBe(0);
    });

    it('resolves assigneeId=me to the caller', async () => {
      const scope = await setupScope();
      await createTask(scope, { title: 'Mine', assigneeId: scope.owner.userId });
      await createTask(scope, { title: 'Nobody’s' });

      expect(await listTitles(scope, '?assigneeId=me')).toEqual(['Mine']);
    });

    it('filters by status, accepting a repeated or comma-separated value', async () => {
      const scope = await setupScope();
      await createTask(scope, { title: 'Todo one' });
      await createTask(scope, { title: 'Doing one', status: TaskStatus.IN_PROGRESS });
      await createTask(scope, { title: 'Done one', status: TaskStatus.DONE });

      expect(await listTitles(scope, `?status=${TaskStatus.DONE}`)).toEqual(['Done one']);
      expect(
        (await listTitles(scope, `?status=${TaskStatus.TODO},${TaskStatus.DONE}`)).sort(),
      ).toEqual(['Done one', 'Todo one']);
    });

    it('filters by priority, section and title search', async () => {
      const scope = await setupScope();
      await createTask(scope, { title: 'Urgent fix', priority: TaskPriority.CRITICAL });
      await createTask(scope, { title: 'Later thing', sectionId: scope.sections[1]!.id });

      expect(await listTitles(scope, `?priority=${TaskPriority.CRITICAL}`)).toEqual(['Urgent fix']);
      expect(await listTitles(scope, `?sectionId=${scope.sections[1]!.id}`)).toEqual([
        'Later thing',
      ]);
      expect(await listTitles(scope, '?search=URGENT')).toEqual(['Urgent fix']);
    });

    /**
     * Regression guard. The board loads a whole project in one request, well
     * above the shared 100-row pagination ceiling. When the DTO inherited that
     * ceiling every board request 422'd, and the UI rendered it as an empty
     * board — indistinguishable from a project with no tasks.
     */
    it('accepts the board-sized limit', async () => {
      const scope = await setupScope();
      await createTask(scope);

      const response = await request(server())
        .get(`${tasksUrl(scope)}?limit=${BOARD_TASK_LIMIT}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.limit).toBe(BOARD_TASK_LIMIT);
    });

    it('rejects a limit beyond the board ceiling', async () => {
      const scope = await setupScope();

      await request(server())
        .get(`${tasksUrl(scope)}?limit=${BOARD_TASK_LIMIT + 1}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(422);
    });

    it('never returns another workspace’s tasks', async () => {
      const scope = await setupScope();
      await createTask(scope, { title: 'Mine' });

      const other = await request(server())
        .post(url('/workspaces'))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Other Workspace' })
        .expect(201);

      const response = await request(server())
        .get(url(`/workspaces/${other.body.data.id}/tasks`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  describe('update', () => {
    it('updates fields', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      const response = await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Renamed', priority: TaskPriority.HIGH, estimatedMinutes: 90 })
        .expect(200);

      expect(response.body.data).toMatchObject({
        title: 'Renamed',
        priority: TaskPriority.HIGH,
        estimatedMinutes: 90,
      });
    });

    it('derives completedAt from status in both directions', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      const done = await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TaskStatus.DONE })
        .expect(200);
      expect(done.body.data.completedAt).not.toBeNull();

      const reopened = await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TaskStatus.IN_PROGRESS })
        .expect(200);
      expect(reopened.body.data.completedAt).toBeNull();
    });

    it('refuses to reposition through the update endpoint', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      // `forbidNonWhitelisted` is what keeps placement out of field edits.
      await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ sectionId: scope.sections[1]!.id })
        .expect(422);
    });

    it('clears the assignee when null is sent', async () => {
      const scope = await setupScope();
      const task = await createTask(scope, { assigneeId: scope.owner.userId });

      const response = await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ assigneeId: null })
        .expect(200);

      expect(response.body.data.assigneeId).toBeNull();
      expect(response.body.data.assignee).toBeNull();
    });

    it('rejects an empty patch', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({})
        .expect(400);
    });
  });

  describe('moving', () => {
    const move = (scope: Scope, taskId: string, body: object) =>
      request(server())
        .patch(`${tasksUrl(scope)}/${taskId}/move`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send(body)
        .expect(200);

    it('moves a task to another column', async () => {
      const scope = await setupScope();
      const task = await createTask(scope, { title: 'Travelling' });

      const response = await move(scope, task.id, {
        sectionId: scope.sections[2]!.id,
        afterTaskId: null,
      });

      expect(response.body.data.sectionId).toBe(scope.sections[2]!.id);
      expect(response.body.data.projectId).toBe(scope.projectId);
    });

    it('reorders within a column', async () => {
      const scope = await setupScope();
      const a = await createTask(scope, { title: 'A' });
      const b = await createTask(scope, { title: 'B' });
      await createTask(scope, { title: 'C' });

      await move(scope, a.id, { sectionId: scope.sections[0]!.id, afterTaskId: b.id });

      expect(await listTitles(scope, `?sectionId=${scope.sections[0]!.id}`)).toEqual([
        'B',
        'A',
        'C',
      ]);
    });

    it('positions relative to the destination column, not the source', async () => {
      const scope = await setupScope();
      const target = await createTask(scope, {
        title: 'Already there',
        sectionId: scope.sections[1]!.id,
      });
      const mover = await createTask(scope, { title: 'Mover', sectionId: scope.sections[0]!.id });

      await move(scope, mover.id, { sectionId: scope.sections[1]!.id, afterTaskId: target.id });

      expect(await listTitles(scope, `?sectionId=${scope.sections[1]!.id}`)).toEqual([
        'Already there',
        'Mover',
      ]);
    });

    it('detaches a task from any section when sectionId is null', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      const response = await move(scope, task.id, { sectionId: null, afterTaskId: null });
      expect(response.body.data.sectionId).toBeNull();
    });

    it('rejects a section from a different project', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Second Project' })
        .expect(201);

      const response = await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}/move`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ sectionId: other.body.data.sections[0].id, afterTaskId: null })
        .expect(400);

      expect(response.body.error.message).toMatch(/different project/i);
    });

    it('rejects an anchor that is not in the destination column', async () => {
      const scope = await setupScope();
      const elsewhere = await createTask(scope, {
        title: 'Elsewhere',
        sectionId: scope.sections[2]!.id,
      });
      const task = await createTask(scope, { title: 'Mover', sectionId: scope.sections[0]!.id });

      await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}/move`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ sectionId: scope.sections[1]!.id, afterTaskId: elsewhere.id })
        .expect(400);
    });

    /** The scenario the position rebalancing exists for. */
    it('keeps a stable order across many moves into the same slot', async () => {
      const scope = await setupScope();
      const sectionId = scope.sections[0]!.id;
      const anchor = await createTask(scope, { title: 'Anchor' });
      const movers = [
        await createTask(scope, { title: 'M1' }),
        await createTask(scope, { title: 'M2' }),
        await createTask(scope, { title: 'M3' }),
      ];

      for (let round = 0; round < 24; round += 1) {
        await move(scope, movers[round % movers.length]!.id, {
          sectionId,
          afterTaskId: anchor.id,
        });
      }

      const rows = await context.prisma.task.findMany({
        where: { sectionId },
        orderBy: { position: 'asc' },
      });

      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((row) => row.position)).size).toBe(4);
      expect(rows[0]?.title).toBe('Anchor');
    });
  });

  describe('archive and restore', () => {
    it('archives and restores a task', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      const archived = await request(server())
        .delete(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(archived.body.data.archivedAt).not.toBeNull();

      expect(await listTitles(scope)).toEqual([]);
      expect(await listTitles(scope, '?includeArchived=true')).toEqual(['A task']);

      const restored = await request(server())
        .post(`${tasksUrl(scope)}/${task.id}/restore`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(restored.body.data.archivedAt).toBeNull();
    });

    it('archives subtasks along with their parent', async () => {
      const scope = await setupScope();
      const parent = await createTask(scope, { title: 'Parent' });
      const child = await createTask(scope, { title: 'Child', parentTaskId: parent.id });

      await request(server())
        .delete(`${tasksUrl(scope)}/${parent.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const row = await context.prisma.task.findUniqueOrThrow({ where: { id: child.id } });
      expect(row.archivedAt).not.toBeNull();
    });

    it('keeps the row rather than deleting it', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      await request(server())
        .delete(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(await context.prisma.task.findUnique({ where: { id: task.id } })).not.toBeNull();
    });

    it('refuses to archive twice', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      await request(server())
        .delete(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      await request(server())
        .delete(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(409);
    });
  });

  describe('authorisation', () => {
    const addMember = async (scope: Scope, actor: Actor, role: WorkspaceRole) => {
      await context.prisma.workspaceMember.create({
        data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
      });
    };

    it('hides tasks from a non-member', async () => {
      const scope = await setupScope();
      const outsider = await registerUser('Outsider');

      await request(server())
        .get(tasksUrl(scope))
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
    });

    it('404s for a task in another workspace', async () => {
      const scope = await setupScope();
      const task = await createTask(scope);

      const other = await request(server())
        .post(url('/workspaces'))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Other Workspace' })
        .expect(201);

      await request(server())
        .get(url(`/workspaces/${other.body.data.id}/tasks/${task.id}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });

    it('lets a MEMBER create, edit and move but not archive', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const task = await createTask(scope, { title: 'Member task' }, member);

      await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ title: 'Edited' })
        .expect(200);

      await request(server())
        .patch(`${tasksUrl(scope)}/${task.id}/move`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ sectionId: scope.sections[1]!.id, afterTaskId: null })
        .expect(200);

      const denied = await request(server())
        .delete(`${tasksUrl(scope)}/${task.id}`)
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);

      expect(denied.body.error.code).toBe('INSUFFICIENT_WORKSPACE_ROLE');
    });

    it('lets a GUEST read but not create', async () => {
      const scope = await setupScope();
      const guest = await registerUser('Guest');
      await addMember(scope, guest, WorkspaceRole.GUEST);

      await request(server())
        .get(tasksUrl(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .expect(200);

      await request(server())
        .post(tasksUrl(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ title: 'Guest task' })
        .expect(403);
    });
  });

  describe('notifications', () => {
    it('notifies the assignee when someone else assigns them', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await context.prisma.workspaceMember.create({
        data: { workspaceId: scope.workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
      });

      await createTask(scope, { title: 'For you', assigneeId: member.userId });

      const notifications = await context.prisma.notification.findMany({
        where: { userId: member.userId, type: 'TASK_ASSIGNED' },
      });
      expect(notifications).toHaveLength(1);
    });

    it('does not notify you about your own assignment', async () => {
      const scope = await setupScope();
      await createTask(scope, { title: 'Mine', assigneeId: scope.owner.userId });

      const notifications = await context.prisma.notification.findMany({
        where: { userId: scope.owner.userId, type: 'TASK_ASSIGNED' },
      });
      expect(notifications).toHaveLength(0);
    });
  });
});
