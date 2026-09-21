import {
  API_PREFIX,
  COMMENT_MAX_LENGTH,
  MAX_MENTIONS_PER_COMMENT,
  WorkspaceRole,
  formatMention,
} from '@coretask/contracts';
import { randomUUID } from 'node:crypto';

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

      // Stored as the editor's markup: one paragraph, sanitised.
      expect(comment).toMatchObject({
        body: '<p>Blocked on storage</p>',
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

      expect(task.body.data.map((c: { body: string }) => c.body)).toEqual(['<p>On the task</p>']);
    });

    it('orders a thread oldest first, so it reads top to bottom', async () => {
      const scope = await setupScope();
      await postComment(taskThread(scope), scope.owner, 'First');
      await postComment(taskThread(scope), scope.owner, 'Second');

      const response = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.map((c: { body: string }) => c.body)).toEqual([
        '<p>First</p>',
        '<p>Second</p>',
      ]);
    });

    it('trims the body and rejects one that is only whitespace', async () => {
      const scope = await setupScope();

      const comment = await postComment(taskThread(scope), scope.owner, '  padded  ');
      expect(comment.body).toBe('<p>padded</p>');

      await request(server())
        .post(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: '   ' })
        .expect(422);
    });

    it('refuses markup with nothing in it, and strips what the editor never emits', async () => {
      const scope = await setupScope();

      await request(server())
        .post(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: '<p>   </p>' })
        .expect(422);

      const comment = await postComment(
        taskThread(scope),
        scope.owner,
        '<script>alert(1)</script><p onclick="x">hi <b>there</b></p>',
      );
      expect(comment.body).toBe('<p>hi <b>there</b></p>');
    });

    it('keeps a picture-only comment, and says so in the notification', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada');
      await addMember(scope, member, WorkspaceRole.MEMBER);
      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/followers`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userIds: [member.userId] })
        .expect(201);

      const shot = '019fc880-0000-7000-8000-00000000f00d';
      const comment = await postComment(
        taskThread(scope),
        scope.owner,
        `<img data-attachment="${shot}" alt="shot.png">`,
      );
      expect(comment.body).toContain(`data-attachment="${shot}"`);

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);
      const line = inbox.body.data.items.find(
        (item: { type: string }) => item.type === 'COMMENT_CREATED',
      );
      expect(line.body).toBe('(image)');
    });

    it('converts a row from before comments were rich text on the way out', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada Lovelace');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      await context.prisma.comment.create({
        data: {
          workspaceId: scope.workspaceId,
          authorId: scope.owner.userId,
          taskId: scope.taskId,
          body: `Legacy ${formatMention(member.userId, 'Ada Lovelace')} row`,
        },
      });

      const thread = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(thread.body.data[0].body).toBe(
        `<p>Legacy <span data-mention="${member.userId}">@Ada Lovelace</span> row</p>`,
      );
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

      expect(response.body.data.body).toBe('<p>Revised</p>');
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

  describe('mentions', () => {
    const notificationsOf = async (scope: Scope, actor: Actor, type: string) => {
      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${actor.token}`)
        .expect(200);

      return inbox.body.data.items.filter((item: { type: string }) => item.type === type);
    };

    it('indexes a mention and resolves it on read', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada Lovelace');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const comment = await postComment(
        taskThread(scope),
        scope.owner,
        `Could ${formatMention(member.userId, 'Ada Lovelace')} take a look?`,
      );

      expect(comment.mentions).toHaveLength(1);
      expect(comment.mentions[0]).toMatchObject({ id: member.userId, name: 'Ada Lovelace' });

      const rows = await context.prisma.commentMention.findMany({
        where: { commentId: comment.id },
      });
      expect(rows.map((row) => row.userId)).toEqual([member.userId]);
    });

    it('notifies a mentioned member with MENTIONED, not the generic type', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      await postComment(
        taskThread(scope),
        scope.owner,
        `ping ${formatMention(member.userId, 'Ada')}`,
      );

      expect(await notificationsOf(scope, member, 'MENTIONED')).toHaveLength(1);
      expect(await notificationsOf(scope, member, 'COMMENT_CREATED')).toHaveLength(0);
    });

    /** One comment must never arrive twice, however many ways you qualify. */
    it('sends only the mention notification to someone who is also a watcher', async () => {
      const scope = await setupScope();
      const assignee = await registerUser('Ada');
      await addMember(scope, assignee, WorkspaceRole.MEMBER);

      await request(server())
        .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ assigneeId: assignee.userId })
        .expect(200);

      await postComment(
        taskThread(scope),
        scope.owner,
        `${formatMention(assignee.userId, 'Ada')} any progress?`,
      );

      expect(await notificationsOf(scope, assignee, 'MENTIONED')).toHaveLength(1);
      expect(await notificationsOf(scope, assignee, 'COMMENT_CREATED')).toHaveLength(0);
    });

    it('does not notify someone who mentions themselves', async () => {
      const scope = await setupScope();

      await postComment(
        taskThread(scope),
        scope.owner,
        `note to ${formatMention(scope.owner.userId, 'me')}`,
      );

      expect(await notificationsOf(scope, scope.owner, 'MENTIONED')).toHaveLength(0);
    });

    /**
     * The body is parsed server-side precisely so a client cannot use mentions
     * to notify people it has no business notifying.
     */
    it('ignores a mention of someone outside the workspace', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      const comment = await postComment(
        taskThread(scope),
        scope.owner,
        `hello ${formatMention(stranger.userId, 'Stranger')}`,
      );

      expect(comment.mentions).toHaveLength(0);
      expect(await context.prisma.notification.count({ where: { userId: stranger.userId } })).toBe(
        0,
      );
      // The text is kept as written; only the index and the fan-out drop it.
      expect(comment.body).toContain(stranger.userId);
    });

    it('counts one mention when the same person is named twice', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const token = formatMention(member.userId, 'Ada');
      const comment = await postComment(taskThread(scope), scope.owner, `${token} and ${token}`);

      expect(comment.mentions).toHaveLength(1);
      expect(await notificationsOf(scope, member, 'MENTIONED')).toHaveLength(1);
    });

    it('adds a mention on edit and notifies only the new person', async () => {
      const scope = await setupScope();
      const first = await registerUser('Ada');
      const second = await registerUser('Grace');
      await addMember(scope, first, WorkspaceRole.MEMBER);
      await addMember(scope, second, WorkspaceRole.MEMBER);

      const comment = await postComment(
        taskThread(scope),
        scope.owner,
        `${formatMention(first.userId, 'Ada')} thoughts?`,
      );

      await request(server())
        .patch(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          body: `${formatMention(first.userId, 'Ada')} ${formatMention(second.userId, 'Grace')} thoughts?`,
        })
        .expect(200);

      // Ada was already named; fixing a comment must not ping her again.
      expect(await notificationsOf(scope, first, 'MENTIONED')).toHaveLength(1);
      expect(await notificationsOf(scope, second, 'MENTIONED')).toHaveLength(1);
    });

    it('removes a mention when the token is edited out', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const comment = await postComment(
        taskThread(scope),
        scope.owner,
        `${formatMention(member.userId, 'Ada')} thoughts?`,
      );

      const updated = await request(server())
        .patch(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'Never mind, worked it out.' })
        .expect(200);

      expect(updated.body.data.mentions).toHaveLength(0);
      expect(await context.prisma.commentMention.count({ where: { commentId: comment.id } })).toBe(
        0,
      );
    });

    it('caps how many people one comment can mention', async () => {
      const scope = await setupScope();

      /*
       * Registered one at a time, not with `Promise.all`. Registration hashes
       * with Argon2id, which is deliberately memory-hard, so a dozen at once
       * saturates the container and the socket resets — the test then fails
       * with ECONNRESET for a reason that has nothing to do with mentions.
       */
      const members = [];
      for (let index = 0; index < MAX_MENTIONS_PER_COMMENT + 3; index += 1) {
        const member = await registerUser(`Member ${index}`);
        await addMember(scope, member, WorkspaceRole.MEMBER);
        members.push(member);
      }

      const body = members.map((m, i) => formatMention(m.userId, `Member ${i}`)).join(' ');
      const comment = await postComment(taskThread(scope), scope.owner, body);

      expect(comment.mentions).toHaveLength(MAX_MENTIONS_PER_COMMENT);
    });

    it('keeps the notification body plain text, whatever the comment holds', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      await postComment(
        taskThread(scope),
        scope.owner,
        `${formatMention(member.userId, 'Ada Lovelace')} please review`,
      );

      const [notification] = await notificationsOf(scope, member, 'MENTIONED');
      expect(notification.body).toBe('@Ada Lovelace please review');
      expect(notification.body).not.toContain(member.userId);
    });

    it('keeps a mention readable after the member is removed from the workspace', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const comment = await postComment(
        taskThread(scope),
        scope.owner,
        `${formatMention(member.userId, 'Ada')} thoughts?`,
      );
      expect(comment.mentions).toHaveLength(1);

      await context.prisma.workspaceMember.deleteMany({
        where: { workspaceId: scope.workspaceId, userId: member.userId },
      });

      // The row survives — membership is not what the index hangs off — and the
      // body still carries the label for the renderer.
      const thread = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(thread.body.data[0].body).toContain('Ada');
      expect(thread.body.data[0].body).toContain(`data-mention="${member.userId}"`);
    });

    /**
     * Editing an old comment that names someone since departed must still work.
     * Rejecting the write would make the comment permanently uneditable.
     */
    it('still allows an edit when a named member has left', async () => {
      const scope = await setupScope();
      const member = await registerUser('Ada');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      const token = formatMention(member.userId, 'Ada');
      const comment = await postComment(taskThread(scope), scope.owner, `${token} thoughts?`);

      await context.prisma.workspaceMember.deleteMany({
        where: { workspaceId: scope.workspaceId, userId: member.userId },
      });

      const updated = await request(server())
        .patch(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: `${token} thoughts? (bumping)` })
        .expect(200);

      expect(updated.body.data.mentions).toHaveLength(0);
      expect(updated.body.data.body).toContain('bumping');
    });

    it('reports no mentions for an ordinary comment', async () => {
      const scope = await setupScope();
      const comment = await postComment(
        taskThread(scope),
        scope.owner,
        'Plain text, no @ anywhere',
      );

      expect(comment.mentions).toEqual([]);
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
  // -------------------------------------------------------------------------
  describe('likes', () => {
    const like = (scope: Scope, actor: Actor, commentId: string) =>
      request(server())
        .post(`${commentUrl(scope, commentId)}/like`)
        .set('Authorization', `Bearer ${actor.token}`);
    const unlike = (scope: Scope, actor: Actor, commentId: string) =>
      request(server())
        .delete(`${commentUrl(scope, commentId)}/like`)
        .set('Authorization', `Bearer ${actor.token}`);

    it('counts one like per person, however many times they press it', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada Lovelace');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      const comment = await postComment(taskThread(scope), scope.owner);

      const first = await like(scope, ada, comment.id).expect(201);
      expect(first.body.data).toMatchObject({ likeCount: 1, likedByMe: true });
      expect(first.body.data.likedBy.map((user: { id: string }) => user.id)).toEqual([ada.userId]);

      const again = await like(scope, ada, comment.id).expect(201);
      expect(again.body.data.likeCount).toBe(1);

      // The author reads it as somebody else's like.
      const thread = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(thread.body.data[0]).toMatchObject({ likeCount: 1, likedByMe: false });

      const taken = await unlike(scope, ada, comment.id).expect(200);
      expect(taken.body.data).toMatchObject({ likeCount: 0, likedByMe: false, likedBy: [] });
      await unlike(scope, ada, comment.id).expect(200);
    });

    it('is read-only for a guest, and gone with the comment', async () => {
      const scope = await setupScope();
      const guest = await registerUser('Guest');
      await addMember(scope, guest, WorkspaceRole.GUEST);
      const comment = await postComment(taskThread(scope), scope.owner);

      await like(scope, guest, comment.id).expect(403);

      await request(server())
        .delete(commentUrl(scope, comment.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      await like(scope, scope.owner, comment.id).expect(404);
    });

    it('cannot be reached from another workspace', async () => {
      const first = await setupScope();
      const second = await setupScope();
      const comment = await postComment(taskThread(first), first.owner);

      await request(server())
        .post(url(`/workspaces/${second.workspaceId}/comments/${comment.id}/like`))
        .set('Authorization', `Bearer ${second.owner.token}`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('pins', () => {
    const pin = (scope: Scope, actor: Actor, commentId: string) =>
      request(server())
        .post(`${commentUrl(scope, commentId)}/pin`)
        .set('Authorization', `Bearer ${actor.token}`);

    it('lets the author pin, and one pin replaces another', async () => {
      const scope = await setupScope();
      const first = await postComment(taskThread(scope), scope.owner, 'First');
      const second = await postComment(taskThread(scope), scope.owner, 'Second');

      const pinned = await pin(scope, scope.owner, first.id).expect(201);
      expect(pinned.body.data.pinnedAt).not.toBeNull();
      expect(pinned.body.data.pinnedBy.id).toBe(scope.owner.userId);

      await pin(scope, scope.owner, second.id).expect(201);

      const thread = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      const byId = Object.fromEntries(
        thread.body.data.map((c: { id: string; pinnedAt: string | null }) => [c.id, c.pinnedAt]),
      );
      expect(byId[first.id]).toBeNull();
      expect(byId[second.id]).not.toBeNull();
      expect(thread.body.meta.pinnedCommentId).toBe(second.id);

      const story = await context.prisma.activityLog.findFirst({
        where: { entity: 'TASK', entityId: scope.taskId, action: 'PINNED' },
      });
      expect(story?.metadata).toMatchObject({ commentId: first.id });

      await request(server())
        .delete(`${commentUrl(scope, second.id)}/pin`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      const after = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(after.body.meta.pinnedCommentId).toBeNull();
    });

    it('refuses a member pinning somebody else’s words, and lets a manager', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada');
      const manager = await registerUser('Manager');
      await addMember(scope, ada, WorkspaceRole.MEMBER);
      await addMember(scope, manager, WorkspaceRole.MANAGER);
      const comment = await postComment(taskThread(scope), scope.owner);

      await pin(scope, ada, comment.id).expect(403);
      await pin(scope, manager, comment.id).expect(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('paging', () => {
    it('serves the latest window first and walks back without repeating a line', async () => {
      const scope = await setupScope();
      // Straight into the table: sixty round trips would spend the suite's
      // budget on setup. Ids are v7, so a later row sorts later.
      for (let index = 1; index <= 60; index += 1) {
        await context.prisma.comment.create({
          data: {
            workspaceId: scope.workspaceId,
            authorId: scope.owner.userId,
            taskId: scope.taskId,
            body: `<p>Comment ${index}</p>`,
          },
        });
      }

      const first = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(first.body.data).toHaveLength(50);
      expect(first.body.data[0].body).toBe('<p>Comment 11</p>');
      expect(first.body.data[49].body).toBe('<p>Comment 60</p>');
      expect(first.body.meta).toMatchObject({ total: 60, hasEarlier: true });
      expect(first.body.meta.earliestId).toBe(first.body.data[0].id);

      const earlier = await request(server())
        .get(taskThread(scope))
        .query({ before: first.body.meta.earliestId })
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(earlier.body.data.map((c: { body: string }) => c.body)).toEqual(
        Array.from({ length: 10 }, (_, index) => `<p>Comment ${index + 1}</p>`),
      );
      expect(earlier.body.meta).toMatchObject({ hasEarlier: false, earliestId: null });

      const ids = new Set(
        [...first.body.data, ...earlier.body.data].map((c: { id: string }) => c.id),
      );
      expect(ids.size).toBe(60);
    });

    it('carries the pinned comment in the first window whatever its age', async () => {
      const scope = await setupScope();
      const old = await postComment(taskThread(scope), scope.owner, 'Pinned and old');
      for (let index = 1; index <= 55; index += 1) {
        await context.prisma.comment.create({
          data: {
            workspaceId: scope.workspaceId,
            authorId: scope.owner.userId,
            taskId: scope.taskId,
            body: `<p>Filler ${index}</p>`,
          },
        });
      }
      await request(server())
        .post(`${commentUrl(scope, old.id)}/pin`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(201);

      const first = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(first.body.data[0].id).toBe(old.id);
      expect(first.body.data).toHaveLength(51);
      expect(first.body.meta.pinnedCommentId).toBe(old.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('attachments', () => {
    const readyFile = async (scope: Scope, uploaderId: string, overrides: object = {}) =>
      context.prisma.attachment.create({
        data: {
          workspaceId: scope.workspaceId,
          uploaderId,
          taskId: scope.taskId,
          filename: 'spec.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1200,
          objectKey: `workspaces/${scope.workspaceId}/${randomUUID()}.pdf`,
          status: 'READY',
          ...overrides,
        },
      });

    it('links the author’s confirmed files to the comment, and keeps them on the task', async () => {
      const scope = await setupScope();
      const file = await readyFile(scope, scope.owner.userId);

      const response = await request(server())
        .post(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'See attached', attachmentIds: [file.id] })
        .expect(201);
      expect(response.body.data.attachments.map((a: { id: string }) => a.id)).toEqual([file.id]);
      expect(response.body.data.attachments[0].commentId).toBe(response.body.data.id);

      const strip = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/attachments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(strip.body.data.map((a: { id: string }) => a.id)).toEqual([file.id]);

      // The file is the task's; deleting the words leaves it.
      await request(server())
        .delete(commentUrl(scope, response.body.data.id))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(await context.prisma.attachment.findUnique({ where: { id: file.id } })).not.toBeNull();
    });

    it('refuses a file that is pending, somebody else’s, elsewhere, or already posted', async () => {
      const scope = await setupScope();
      const ada = await registerUser('Ada');
      await addMember(scope, ada, WorkspaceRole.MEMBER);

      const pending = await readyFile(scope, scope.owner.userId, { status: 'PENDING' });
      const theirs = await readyFile(scope, ada.userId);
      const onTicket = await readyFile(scope, scope.owner.userId, {
        taskId: null,
        ticketId: scope.ticketId,
      });
      const posted = await readyFile(scope, scope.owner.userId);
      await request(server())
        .post(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: 'first', attachmentIds: [posted.id] })
        .expect(201);

      for (const id of [pending.id, theirs.id, onTicket.id, posted.id]) {
        await request(server())
          .post(taskThread(scope))
          .set('Authorization', `Bearer ${scope.owner.token}`)
          .send({ body: 'nope', attachmentIds: [id] })
          .expect(400);
      }

      // A refused claim leaves no comment behind.
      const thread = await request(server())
        .get(taskThread(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      expect(thread.body.meta.total).toBe(1);
    });

    it('never links a file from another workspace', async () => {
      const first = await setupScope();
      const second = await setupScope();
      const foreign = await readyFile(second, second.owner.userId, { taskId: second.taskId });

      await request(server())
        .post(taskThread(first))
        .set('Authorization', `Bearer ${first.owner.token}`)
        .send({ body: 'nope', attachmentIds: [foreign.id] })
        .expect(400);
    });
  });
});
