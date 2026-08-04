import { API_PREFIX, NotificationType, WorkspaceRole, formatMention } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * An inbox belongs to one person. Every query is scoped by the caller's id as
 * well as the workspace, and the route carries no user id to tamper with — so
 * the isolation tests here are the ones that matter most.
 */
describe('Notifications (e2e)', () => {
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
    name: string;
  }

  const registerUser = async (name = 'Test User'): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);

    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
      name,
    };
  };

  interface Scope {
    owner: Actor;
    member: Actor;
    workspaceId: string;
    taskId: string;
  }

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser('Owner');
    const member = await registerUser('Member');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Acme Product' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });

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

    return { owner, member, workspaceId, taskId: task.body.data.id as string };
  };

  /**
   * Creating a workspace sends its owner a welcome notification, which is real
   * behaviour (pinned by its own test below) but noise for everything else.
   * Clearing it lets the rest assert exact counts instead of offsets.
   */
  const setupEmptyScope = async (): Promise<Scope> => {
    const scope = await setupScope();
    await context.prisma.notification.deleteMany({ where: { workspaceId: scope.workspaceId } });
    return scope;
  };

  const feed = (scope: Scope, actor: Actor, query = '') =>
    request(server())
      .get(url(`/workspaces/${scope.workspaceId}/notifications${query}`))
      .set('Authorization', `Bearer ${actor.token}`);

  /** Seeds notifications directly; going through comments would be far slower. */
  const seed = async (scope: Scope, actor: Actor, count: number, type: NotificationType) => {
    for (let index = 0; index < count; index += 1) {
      await context.prisma.notification.create({
        data: {
          userId: actor.userId,
          workspaceId: scope.workspaceId,
          type,
          title: `${type} ${index}`,
          actionUrl: '/my-tasks',
        },
      });
    }
  };

  describe('isolation', () => {
    it('never shows one member another member’s notifications', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.member, 3, NotificationType.MENTIONED);

      const ownerFeed = await feed(scope, scope.owner).expect(200);
      const memberFeed = await feed(scope, scope.member).expect(200);

      expect(ownerFeed.body.data.items).toEqual([]);
      expect(ownerFeed.body.data.unreadCount).toBe(0);
      expect(memberFeed.body.data.items).toHaveLength(3);
    });

    it('does not leak across workspaces', async () => {
      const first = await setupEmptyScope();
      const second = await setupEmptyScope();
      await seed(first, first.owner, 2, NotificationType.MENTIONED);

      const other = await request(server())
        .get(url(`/workspaces/${second.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${second.owner.token}`)
        .expect(200);

      expect(other.body.data.items).toEqual([]);
    });

    it('refuses a non-member', async () => {
      const scope = await setupEmptyScope();
      const stranger = await registerUser('Stranger');

      await feed(scope, stranger).expect(403);
    });

    it('cannot be read anonymously', async () => {
      const scope = await setupEmptyScope();

      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .expect(401);
    });
  });

  describe('filtering', () => {
    it('narrows to unread only', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 3, NotificationType.MENTIONED);

      const all = await feed(scope, scope.owner).expect(200);
      const first = all.body.data.items[0].id as string;

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ notificationIds: [first] })
        .expect(200);

      const unread = await feed(scope, scope.owner, '?unreadOnly=true').expect(200);

      expect(unread.body.data.items).toHaveLength(2);
      expect(unread.body.data.items.every((i: { readAt: null }) => i.readAt === null)).toBe(true);
    });

    /*
     * A query string carries strings, so a naive boolean cast turns "false" into
     * true and silently inverts the filter — the reader sees only unread items
     * on a tab that promised everything.
     */
    it('treats unreadOnly=false as no filter, not as true', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 2, NotificationType.MENTIONED);

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({})
        .expect(200);

      const response = await feed(scope, scope.owner, '?unreadOnly=false').expect(200);

      expect(response.body.data.items).toHaveLength(2);
    });

    it('narrows to a type', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 2, NotificationType.MENTIONED);
      await seed(scope, scope.owner, 3, NotificationType.TASK_ASSIGNED);

      const mentions = await feed(scope, scope.owner, '?types=MENTIONED').expect(200);

      expect(mentions.body.data.items).toHaveLength(2);
    });

    it('accepts several types at once', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 1, NotificationType.MENTIONED);
      await seed(scope, scope.owner, 1, NotificationType.TASK_ASSIGNED);
      await seed(scope, scope.owner, 1, NotificationType.COMMENT_CREATED);

      const response = await feed(
        scope,
        scope.owner,
        '?types=MENTIONED&types=TASK_ASSIGNED',
      ).expect(200);

      expect(response.body.data.items).toHaveLength(2);
    });

    it('refuses a type that does not exist', async () => {
      const scope = await setupEmptyScope();

      await feed(scope, scope.owner, '?types=NOT_A_REAL_TYPE').expect(422);
    });

    it('counts unread across the workspace even when filtered', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 2, NotificationType.MENTIONED);
      await seed(scope, scope.owner, 3, NotificationType.TASK_ASSIGNED);

      const filtered = await feed(scope, scope.owner, '?types=MENTIONED').expect(200);

      // The badge counts the inbox, not the tab.
      expect(filtered.body.data.items).toHaveLength(2);
      expect(filtered.body.data.unreadCount).toBe(5);
    });
  });

  describe('paging', () => {
    it('walks the whole inbox without repeating or skipping', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 7, NotificationType.MENTIONED);

      const seen: string[] = [];
      let cursor: string | undefined;

      for (let page = 0; page < 5; page += 1) {
        const response = await feed(
          scope,
          scope.owner,
          `?limit=3${cursor ? `&cursor=${cursor}` : ''}`,
        ).expect(200);

        seen.push(...response.body.data.items.map((i: { id: string }) => i.id));
        cursor = response.body.data.nextCursor ?? undefined;
        if (!cursor) break;
      }

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
    });

    it('reports no cursor on the last page', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 2, NotificationType.MENTIONED);

      const response = await feed(scope, scope.owner, '?limit=10').expect(200);

      expect(response.body.data.nextCursor).toBeNull();
    });
  });

  describe('read state', () => {
    it('marks one entry read without touching the rest', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 3, NotificationType.MENTIONED);
      const all = await feed(scope, scope.owner).expect(200);
      const target = all.body.data.items[0].id as string;

      const result = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ notificationIds: [target] })
        .expect(200);

      expect(result.body.data).toEqual({ updated: 1, unreadCount: 2 });
    });

    it('clears the whole inbox when no ids are given', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 4, NotificationType.MENTIONED);

      const result = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({})
        .expect(200);

      expect(result.body.data).toEqual({ updated: 4, unreadCount: 0 });
    });

    it('puts one back in the unread pile', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.owner, 2, NotificationType.MENTIONED);
      const all = await feed(scope, scope.owner).expect(200);
      const target = all.body.data.items[0].id as string;

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({})
        .expect(200);

      const result = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/${target}/unread`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(result.body.data).toEqual({ updated: 1, unreadCount: 1 });
    });

    it('cannot mark someone else’s notification read', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.member, 2, NotificationType.MENTIONED);
      const theirs = await feed(scope, scope.member).expect(200);
      const target = theirs.body.data.items[0].id as string;

      // Scoped by userId, so this matches nothing rather than erroring — and
      // crucially changes nothing.
      const result = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ notificationIds: [target] })
        .expect(200);

      expect(result.body.data.updated).toBe(0);

      const after = await feed(scope, scope.member).expect(200);
      expect(after.body.data.unreadCount).toBe(2);
    });

    it('cannot mark someone else’s notification unread', async () => {
      const scope = await setupEmptyScope();
      await seed(scope, scope.member, 1, NotificationType.MENTIONED);
      const theirs = await feed(scope, scope.member).expect(200);
      const target = theirs.body.data.items[0].id as string;

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${scope.member.token}`)
        .send({})
        .expect(200);

      const result = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/${target}/unread`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(result.body.data.updated).toBe(0);
    });
  });

  describe('what actually generates one', () => {
    it('creating a workspace welcomes its owner', async () => {
      const owner = await registerUser('Owner');

      const workspace = await request(server())
        .post(url('/workspaces'))
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name: 'Acme Product' })
        .expect(201);

      const response = await request(server())
        .get(url(`/workspaces/${workspace.body.data.id}/notifications`))
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(200);

      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].title).toContain('Acme Product');
    });

    it('a mention notifies the person named, and only them', async () => {
      const scope = await setupEmptyScope();

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}/comments`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ body: `Hello ${formatMention(scope.member.userId, scope.member.name)}` })
        .expect(201);

      const theirs = await feed(scope, scope.member).expect(200);
      const mine = await feed(scope, scope.owner).expect(200);

      expect(theirs.body.data.items).toHaveLength(1);
      expect(theirs.body.data.items[0].type).toBe(NotificationType.MENTIONED);
      expect(theirs.body.data.items[0].actionUrl).toContain(scope.taskId);
      // The author is not notified about their own comment.
      expect(mine.body.data.items).toEqual([]);
    });
  });
});
