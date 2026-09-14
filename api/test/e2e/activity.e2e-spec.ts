import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Item activity (e2e)', () => {
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
    taskId: string;
  }

  interface Story {
    id: string;
    action: string;
    summary: string;
    metadata: Record<string, unknown> | null;
    actor: { id: string } | null;
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
    const sections = project.body.data.sections as { id: string; name: string }[];

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'Ship the grid', sectionId: sections[0]!.id })
      .expect(201);

    return {
      owner,
      workspaceId,
      projectId: project.body.data.id as string,
      sections,
      taskId: task.body.data.id as string,
    };
  };

  const addMember = async (scope: Scope, actor: Actor, role: WorkspaceRole) => {
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
  };

  const feedOf = async (
    scope: Scope,
    actor: Actor = scope.owner,
    query: Record<string, string> = {},
  ): Promise<{ items: Story[]; nextCursor: string | null }> => {
    const response = await request(server())
      .get(url(`/workspaces/${scope.workspaceId}/activity/item`))
      .query({ entity: 'TASK', entityId: scope.taskId, ...query })
      .set('Authorization', `Bearer ${actor.token}`)
      .expect(200);

    return response.body.data;
  };

  const patchTask = (scope: Scope, body: Record<string, unknown>, actor: Actor = scope.owner) =>
    request(server())
      .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`))
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);

  // -------------------------------------------------------------------------
  describe('the feed', () => {
    it('starts with the creation story', async () => {
      const scope = await setupScope();

      const feed = await feedOf(scope);

      expect(feed.items.map((story) => story.action)).toEqual(['CREATED']);
      expect(feed.items[0]?.actor?.id).toBe(scope.owner.userId);
      expect(feed.nextCursor).toBeNull();
    });

    it('writes one story per property that changed, with what it was and is', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      await patchTask(scope, {
        assigneeId: ada.userId,
        dueDate: '2026-09-12T00:00:00.000Z',
        title: 'Ship the grid, twice',
      }).expect(200);

      const feed = await feedOf(scope);
      const byField = Object.fromEntries(
        feed.items
          .filter((story) => story.metadata && 'field' in story.metadata)
          .map((story) => [story.metadata!['field'], story]),
      );

      expect(byField['title']).toMatchObject({
        action: 'UPDATED',
        metadata: { before: 'Ship the grid', after: 'Ship the grid, twice' },
      });
      expect(byField['assignee']).toMatchObject({
        action: 'ASSIGNED',
        metadata: { before: null, after: { id: ada.userId, label: 'Ada Lovelace' } },
      });
      expect(byField['dueDate']).toMatchObject({
        action: 'UPDATED',
        summary: 'Set the due date',
        metadata: { before: null, after: { date: '2026-09-12T00:00:00.000Z', at: null } },
      });
    });

    it('reads completion as one story, and a reopen as its opposite', async () => {
      const scope = await setupScope();

      await patchTask(scope, { status: 'DONE' }).expect(200);
      await patchTask(scope, { status: 'TODO' }).expect(200);

      const feed = await feedOf(scope);
      const completion = feed.items.filter((story) => story.metadata?.['field'] === 'completed');

      expect(completion.map((story) => story.metadata?.['after'])).toEqual([
        'incomplete',
        'complete',
      ]);
      expect(feed.items.some((story) => story.metadata?.['field'] === 'status')).toBe(false);
    });

    it('files a section move under the task with both names', async () => {
      const scope = await setupScope();

      await request(server())
        .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/move`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ sectionId: scope.sections[1]!.id, afterTaskId: null })
        .expect(200);

      const feed = await feedOf(scope);
      const move = feed.items.find((story) => story.metadata?.['field'] === 'section');

      expect(move).toMatchObject({
        action: 'UPDATED',
        summary: `Moved from ${scope.sections[0]!.name} to ${scope.sections[1]!.name}`,
        metadata: {
          before: { id: scope.sections[0]!.id, label: scope.sections[0]!.name },
          after: { id: scope.sections[1]!.id, label: scope.sections[1]!.name },
        },
      });
    });

    it('writes the same stories through the shared work-item route', async () => {
      const scope = await setupScope();

      await request(server())
        .patch(
          url(
            `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items/${scope.taskId}`,
          ),
        )
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ statusId: 'IN_PROGRESS' })
        .expect(200);

      const feed = await feedOf(scope);
      const status = feed.items.find((story) => story.metadata?.['field'] === 'status');

      expect(status).toMatchObject({
        action: 'STATUS_CHANGED',
        metadata: { after: { id: 'IN_PROGRESS' } },
      });
    });

    it('tells the parent when a subtask is added', async () => {
      const scope = await setupScope();

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Write the tests', parentTaskId: scope.taskId })
        .expect(201);

      const feed = await feedOf(scope);
      const added = feed.items.find((story) => story.action === 'SUBTASK_ADDED');

      expect(added).toMatchObject({
        summary: 'Added subtask “Write the tests”',
        metadata: { title: 'Write the tests' },
      });
    });

    it('leaves comments out, because the thread shows them', async () => {
      const scope = await setupScope();

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/comments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'Hello' })
        .expect(201);

      const feed = await feedOf(scope);

      expect(feed.items.some((story) => story.action === 'COMMENTED')).toBe(false);
    });

    it('still leaves a plain line for an edit it cannot describe', async () => {
      const scope = await setupScope();

      await patchTask(scope, { estimatedMinutes: 90 }).expect(200);

      const feed = await feedOf(scope);

      expect(feed.items[0]).toMatchObject({
        action: 'UPDATED',
        summary: 'Updated task "Ship the grid"',
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('paging', () => {
    it('pages newest first by cursor without repeating a line', async () => {
      const scope = await setupScope();

      for (let index = 1; index <= 4; index += 1) {
        await patchTask(scope, { title: `Rename ${index}` }).expect(200);
      }

      const first = await feedOf(scope, scope.owner, { limit: '3' });
      expect(first.items).toHaveLength(3);
      expect(first.nextCursor).toBe(first.items[2]!.id);
      expect(first.items[0]?.metadata?.['after']).toBe('Rename 4');

      const second = await feedOf(scope, scope.owner, { limit: '3', before: first.nextCursor! });
      expect(second.items.map((story) => story.action)).toEqual(['UPDATED', 'CREATED']);
      expect(second.nextCursor).toBeNull();

      const ids = [...first.items, ...second.items].map((story) => story.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // -------------------------------------------------------------------------
  describe('follower notifications', () => {
    const inboxOf = async (scope: Scope, actor: Actor) => {
      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);

      return inbox.body.data.items as { type: string; title: string }[];
    };

    it('tell collaborators about the due date and completion, not a rename', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      await patchTask(scope, { assigneeId: ada.userId }).expect(200);

      await patchTask(scope, { title: 'Quiet rename' }).expect(200);
      expect(
        (await inboxOf(scope, ada)).filter((item) => item.type === 'TASK_UPDATED'),
      ).toHaveLength(0);

      await patchTask(scope, { dueDate: '2026-09-12T00:00:00.000Z' }).expect(200);
      const updated = (await inboxOf(scope, ada)).filter((item) => item.type === 'TASK_UPDATED');
      expect(updated).toHaveLength(1);
      expect(updated[0]?.title).toBe('Workspace Owner set a due date on “Quiet rename”');

      await patchTask(scope, { status: 'DONE' }).expect(200);
      const completed = (await inboxOf(scope, ada)).filter(
        (item) => item.type === 'TASK_STATUS_CHANGED',
      );
      expect(completed).toHaveLength(1);
      expect(completed[0]?.title).toBe('Workspace Owner marked “Quiet rename” complete');

      // The person who made the change is never told about it.
      expect(
        (await inboxOf(scope, scope.owner)).filter((item) =>
          ['TASK_UPDATED', 'TASK_STATUS_CHANGED'].includes(item.type),
        ),
      ).toHaveLength(0);
    });

    it('stay quiet for somebody who left the task', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      await patchTask(scope, { assigneeId: ada.userId }).expect(200);

      await request(server())
        .delete(
          url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/followers/${ada.userId}`),
        )
        .set('Authorization', `Bearer ${ada.token}`)
        .expect(200);

      await patchTask(scope, { status: 'DONE' }).expect(200);

      expect(
        (await inboxOf(scope, ada)).filter((item) => item.type === 'TASK_STATUS_CHANGED'),
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('validation and isolation', () => {
    it('needs both the entity and its id', async () => {
      const scope = await setupScope();

      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/activity/item`))
        .query({ entity: 'TASK' })
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(422);
    });

    it('shows another workspace nothing, not even that the task exists', async () => {
      const first = await setupScope();
      const second = await setupScope();

      const response = await request(server())
        .get(url(`/workspaces/${second.workspaceId}/activity/item`))
        .query({ entity: 'TASK', entityId: first.taskId })
        .set('Authorization', `Bearer ${second.owner.token}`)
        .expect(200);

      expect(response.body.data.items).toEqual([]);
    });

    it('keeps a non-member out', async () => {
      const scope = await setupScope();
      const outsider = await registerUser('Outsider');

      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/activity/item`))
        .query({ entity: 'TASK', entityId: scope.taskId })
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(403);
    });

    it('carries metadata on the workspace feed too', async () => {
      const scope = await setupScope();
      await patchTask(scope, { title: 'Renamed' }).expect(200);

      const feed = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/activity`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(feed.body.data[0]).toMatchObject({ metadata: { field: 'title', after: 'Renamed' } });
    });
  });
});
