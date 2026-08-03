import { API_PREFIX, COMMENT_MAX_LENGTH, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Comments (e2e)', () => {
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

  /** No HTTP endpoint issues invitations yet, so membership is seeded directly. */
  const addMember = async (scope: Scope, actor: Actor, role: WorkspaceRole) => {
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
  };

  const taskThread = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/comments`);
  const ticketThread = (scope: Scope, ref = scope.ticketKey) =>
    url(`/workspaces/${scope.workspaceId}/tickets/${ref}/comments`);
  const commentUrl = (scope: Scope, commentId: string) =>
    url(`/workspaces/${scope.workspaceId}/comments/${commentId}`);

  const postComment = async (thread: string, actor: Actor, body = 'A comment') => {
    const response = await request(server())
      .post(thread)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ body })
      .expect(201);

    return response.body.data;
  };

  describe('posting', () => {
    it('attaches a comment to a task and leaves the ticket column null', async () => {
      const scope = await setupScope();
      const comment = await postComment(taskThread(scope), scope.owner, 'Blocked on storage');

      expect(comment).toMatchObject({
        body: 'Blocked on storage',
        taskId: scope.taskId,
        ticketId: null,
        authorId: scope.owner.userId,
        editedAt: null,
      });
      expect(comment.author.id).toBe(scope.owner.userId);
    });

    it('attaches a comment to a ticket addressed by key', async () => {
      const scope = await setupScope();
      const comment = await postComment(ticketThread(scope), scope.owner);

      expect(comment.ticketId).toBe(scope.ticketId);
      expect(comment.taskId).toBeNull();
    });

    /** The key is what people paste; both spellings have to reach one thread. */
    it('reads the same thread whether the ticket is addressed by key or id', async () => {
      const scope = await setupScope();
      await postComment(ticketThread(scope), scope.owner);

      const byKey = await request(server())
        .get(ticketThread(scope, scope.ticketKey))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const byId = await request(server())
        .get(ticketThread(scope, scope.ticketId))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(byKey.body.meta.total).toBe(1);
      expect(byId.body.data[0].id).toBe(byKey.body.data[0].id);
    });

    it('keeps task and ticket threads separate', async () => {
      const scope = await setupScope();
      await postComment(taskThread(scope), scope.owner, 'On the task');
      await postComment(ticketThread(scope), scope.owner, 'On the ticket');

      const task = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(task.body.data.map((c: { body: string }) => c.body)).toEqual(['On the task']);
    });

    it('orders a thread oldest first, so it reads top to bottom', async () => {
      const scope = await setupScope();
      await postComment(taskThread(scope), scope.owner, 'First');
      await postComment(taskThread(scope), scope.owner, 'Second');

      const response = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.map((c: { body: string }) => c.body)).toEqual(['First', 'Second']);
    });

    it('trims the body and rejects one that is only whitespace', async () => {
      const scope = await setupScope();

      const comment = await postComment(taskThread(scope), scope.owner, '  padded  ');
      expect(comment.body).toBe('padded');

      await request(server())
        .post(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: '   ' })
        .expect(422);
    });

    it('rejects a body past the maximum length', async () => {
      const scope = await setupScope();

      await request(server())
        .post(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'x'.repeat(COMMENT_MAX_LENGTH + 1) })
        .expect(422);
    });

    it('404s on a parent that does not exist in this workspace', async () => {
      const scope = await setupScope();

      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/tickets/ACME-9999/comments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });
  });

  describe('editing', () => {
    it('sets editedAt and changes the body', async () => {
      const scope = await setupScope();
      const comment = await postComment(taskThread(scope), scope.owner, 'Original');

      const response = await request(server())
        .patch(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'Revised' })
        .expect(200);

      expect(response.body.data.body).toBe('Revised');
      expect(response.body.data.editedAt).not.toBeNull();
    });

    /** Rewriting what someone else said is not a moderation power. */
    it('refuses anyone but the author, including an owner', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const theirs = await postComment(taskThread(scope), member, 'Their words');

      await request(server())
        .patch(commentUrl(scope, theirs.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'Rewritten by the owner' })
        .expect(403);
    });
  });

  describe('deleting', () => {
    it('lets an author remove their own comment', async () => {
      const scope = await setupScope();
      const comment = await postComment(taskThread(scope), scope.owner);

      await request(server())
        .delete(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const thread = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(thread.body.meta.total).toBe(0);
    });

    /**
     * Soft delete: activity entries point at the row, and a dangling reference
     * in an audit trail is worse than a row nobody renders.
     */
    it('keeps the row after deletion', async () => {
      const scope = await setupScope();
      const comment = await postComment(taskThread(scope), scope.owner);

      await request(server())
        .delete(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const row = await context.prisma.comment.findUnique({ where: { id: comment.id } });
      expect(row).not.toBeNull();
      expect(row?.deletedAt).not.toBeNull();
    });

    it('refuses a member deleting someone else’s comment', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const theirs = await postComment(taskThread(scope), scope.owner);

      await request(server())
        .delete(commentUrl(scope, theirs.id))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);
    });

    it('lets a manager remove someone else’s comment, and records who did', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const manager = await registerUser('Manager');
      await addMember(scope, member, WorkspaceRole.MEMBER);
      await addMember(scope, manager, WorkspaceRole.MANAGER);

      const theirs = await postComment(taskThread(scope), member, 'Off topic');

      await request(server())
        .delete(commentUrl(scope, theirs.id))
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);

      const audit = await context.prisma.activityLog.findMany({
        where: { workspaceId: scope.workspaceId, entity: 'COMMENT', action: 'DELETED' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.actorId).toBe(manager.userId);
    });

    it('does not write an audit line when authors delete their own', async () => {
      const scope = await setupScope();
      const comment = await postComment(taskThread(scope), scope.owner);

      await request(server())
        .delete(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const audit = await context.prisma.activityLog.findMany({
        where: { workspaceId: scope.workspaceId, entity: 'COMMENT', action: 'DELETED' },
      });
      expect(audit).toHaveLength(0);
    });

    it('treats an already-deleted comment as gone', async () => {
      const scope = await setupScope();
      const comment = await postComment(taskThread(scope), scope.owner);

      await request(server())
        .delete(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      await request(server())
        .patch(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'Resurrect' })
        .expect(404);
    });
  });

  describe('tenant isolation', () => {
    it('refuses a non-member entirely', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(403);
    });

    it('will not edit a comment through another workspace’s route', async () => {
      const first = await setupScope();
      const second = await setupScope();
      const comment = await postComment(taskThread(first), first.owner);

      // `second.owner` is a legitimate member *there*, so the guard passes and
      // only the workspace-scoped lookup stands between them and the comment.
      await request(server())
        .patch(commentUrl(second, comment.id))
        .set('Authorization', `Bearer ${second.owner.token}`)
        .send({ body: 'Cross-tenant edit' })
        .expect(404);
    });

    it('will not read another workspace’s thread', async () => {
      const first = await setupScope();
      const second = await setupScope();

      await request(server())
        .get(url(`/workspaces/${second.workspaceId}/tasks/${first.taskId}/comments`))
        .set('Authorization', `Bearer ${second.owner.token}`)
        .expect(404);
    });

    it('requires MEMBER to post', async () => {
      const scope = await setupScope();
      const guest = await registerUser('Guest');
      await addMember(scope, guest, WorkspaceRole.GUEST);

      await request(server())
        .post(taskThread(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ body: 'Guests cannot comment' })
        .expect(403);

      // Reading stays open to every member.
      await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .expect(200);
    });

    it('requires authentication', async () => {
      const scope = await setupScope();
      await request(server()).get(taskThread(scope)).expect(401);
    });
  });

  describe('notifications', () => {
    it('notifies the assignee when someone else comments', async () => {
      const scope = await setupScope();
      const assignee = await registerUser('Assignee');
      await addMember(scope, assignee, WorkspaceRole.MEMBER);

      await request(server())
        .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ assigneeId: assignee.userId })
        .expect(200);

      await postComment(taskThread(scope), scope.owner, 'Any progress?');

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${assignee.token}`)
        .expect(200);

      const comments = inbox.body.data.items.filter(
        (item: { type: string }) => item.type === 'COMMENT_CREATED',
      );
      expect(comments).toHaveLength(1);
    });

    /**
     * Replying is how you join a thread. Without this, a conversation between
     * two people goes silent for whichever of them is not the assignee.
     */
    it('notifies prior commenters, not just the assignee', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      await postComment(taskThread(scope), member, 'I looked into this');
      await postComment(taskThread(scope), scope.owner, 'Thanks');

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);

      const comments = inbox.body.data.items.filter(
        (item: { type: string }) => item.type === 'COMMENT_CREATED',
      );
      expect(comments).toHaveLength(1);
      expect(comments[0].entity).toBe('COMMENT');
    });

    it('never notifies the person who wrote the comment', async () => {
      const scope = await setupScope();

      await postComment(taskThread(scope), scope.owner, 'Note to self');
      await postComment(taskThread(scope), scope.owner, 'And another');

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const comments = inbox.body.data.items.filter(
        (item: { type: string }) => item.type === 'COMMENT_CREATED',
      );
      expect(comments).toHaveLength(0);
    });

    it('notifies each watcher once, however many roles they hold', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      // Reporter *and* assignee of the same ticket, and already in the thread.
      const ticket = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tickets`))
        .set('Authorization', `Bearer ${member.token}`)
        .send({ title: 'Mine end to end', assigneeId: member.userId })
        .expect(201);

      const thread = ticketThread(scope, ticket.body.data.key as string);
      await postComment(thread, member, 'Starting on this');
      await postComment(thread, scope.owner, 'Ping');

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);

      const comments = inbox.body.data.items.filter(
        (item: { type: string }) => item.type === 'COMMENT_CREATED',
      );
      expect(comments).toHaveLength(1);
    });

    it('writes an activity line naming what was commented on', async () => {
      const scope = await setupScope();
      await postComment(ticketThread(scope), scope.owner);

      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/activity`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const summaries = response.body.data.map((entry: { summary: string }) => entry.summary);
      expect(summaries).toContain(`Commented on ${scope.ticketKey}`);
    });
  });
});
