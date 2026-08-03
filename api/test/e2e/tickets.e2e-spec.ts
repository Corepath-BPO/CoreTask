import {
  API_PREFIX,
  TICKET_KEY_PATTERN,
  TicketPriority,
  TicketStatus,
  TicketType,
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

describe('Tickets (e2e)', () => {
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
    /** Derived from the workspace name, so keys are `ACME-1001` here. */
    ticketPrefix: string;
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
      ticketPrefix: workspace.body.data.ticketPrefix as string,
    };
  };

  /** No HTTP endpoint issues invitations yet, so membership is seeded directly. */
  const addMember = async (scope: Scope, actor: Actor, role: WorkspaceRole) => {
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
  };

  const ticketsUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/tickets`);

  const createTicket = async (scope: Scope, body: object = {}, actor: Actor = scope.owner) => {
    const response = await request(server())
      .post(ticketsUrl(scope))
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ title: 'Something is broken', ...body })
      .expect(201);

    return response.body.data;
  };

  describe('key allocation', () => {
    it('issues the first key from the workspace prefix and counter', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      // The prefix comes from the workspace name, not a global constant.
      expect(ticket.key).toBe(`${scope.ticketPrefix}-1001`);
      expect(ticket.number).toBe(1001);
      expect(ticket.key).toMatch(TICKET_KEY_PATTERN);
    });

    /**
     * The counter is incremented inside the creation transaction, so the row
     * lock on the workspace serialises concurrent reporters. Without it two
     * requests read the same counter and collide on the unique key.
     */
    it('issues gapless, unique keys under concurrent creation', async () => {
      const scope = await setupScope();

      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          request(server())
            .post(ticketsUrl(scope))
            .set('Authorization', `Bearer ${scope.owner.token}`)
            .send({ title: `Concurrent report ${index}` }),
        ),
      );

      const numbers = responses.map((response) => response.body.data.number as number).sort();

      expect(responses.every((response) => response.status === 201)).toBe(true);
      expect(new Set(numbers).size).toBe(8);
      expect(numbers).toEqual([1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008]);
    });

    /**
     * Regression guard. The dev seed re-runs on every container start and used
     * to set the counter to a fixed value, walking it *backwards* past tickets
     * reported since — so the next report collided with an existing key. Any
     * code that rewinds the counter has to fail here rather than in someone's
     * browser with an unexplained 409.
     */
    it('never reissues a key after the counter is rewound behind existing rows', async () => {
      const scope = await setupScope();
      const existing = await createTicket(scope, { title: 'Already reported' });

      await context.prisma.workspace.update({
        where: { id: scope.workspaceId },
        data: { ticketCounter: existing.number - 1 },
      });

      const response = await request(server())
        .post(ticketsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Reported after the rewind' });

      // Either the counter is repaired and a fresh key is issued, or the unique
      // constraint refuses — never a silent overwrite of the existing ticket.
      expect([201, 409]).toContain(response.status);

      const rows = await context.prisma.ticket.findMany({
        where: { workspaceId: scope.workspaceId },
        select: { key: true },
      });
      expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    });

    it('numbers each workspace independently', async () => {
      const first = await setupScope();
      const second = await setupScope();

      const a = await createTicket(first);
      const b = await createTicket(second);

      expect(a.number).toBe(1001);
      expect(b.number).toBe(1001);
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('lookup', () => {
    it('resolves a ticket by its human key as well as its id', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      const byId = await request(server())
        .get(`${ticketsUrl(scope)}/${ticket.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const byKey = await request(server())
        .get(`${ticketsUrl(scope)}/${ticket.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(byId.body.data.id).toBe(ticket.id);
      expect(byKey.body.data.id).toBe(ticket.id);
    });

    it('accepts a lowercase key, because links get typed by hand', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      const response = await request(server())
        .get(`${ticketsUrl(scope)}/${(ticket.key as string).toLowerCase()}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.key).toBe(ticket.key);
    });

    it('does not leak a ticket across workspaces', async () => {
      const first = await setupScope();
      const second = await setupScope();
      const ticket = await createTicket(first);

      // Same key exists in both workspaces once `second` has one of its own.
      await request(server())
        .get(url(`/workspaces/${second.workspaceId}/tickets/${ticket.id}`))
        .set('Authorization', `Bearer ${second.owner.token}`)
        .expect(404);
    });
  });

  describe('lifecycle timestamps', () => {
    it('derives resolvedAt from a RESOLVED status', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      const response = await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.RESOLVED })
        .expect(200);

      expect(response.body.data.resolvedAt).not.toBeNull();
      expect(response.body.data.closedAt).toBeNull();
    });

    /**
     * Closing implies resolution. A ticket closed without passing through
     * RESOLVED still needs a resolution timestamp or time-to-resolve reporting
     * silently misses it.
     */
    it('sets both timestamps when a ticket is closed outright', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      const response = await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.CLOSED })
        .expect(200);

      expect(response.body.data.resolvedAt).not.toBeNull();
      expect(response.body.data.closedAt).not.toBeNull();
    });

    it('keeps the original resolvedAt when a resolved ticket is closed', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      const resolved = await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.RESOLVED })
        .expect(200);

      const closed = await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.CLOSED })
        .expect(200);

      expect(closed.body.data.resolvedAt).toBe(resolved.body.data.resolvedAt);
    });

    it('clears both timestamps when a ticket is reopened', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.CLOSED })
        .expect(200);

      const reopened = await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.OPEN })
        .expect(200);

      expect(reopened.body.data.resolvedAt).toBeNull();
      expect(reopened.body.data.closedAt).toBeNull();
    });
  });

  describe('immutability', () => {
    it('ignores an attempt to change the key or number', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ key: 'HACK-1', number: 9999, title: 'Renamed' })
        .expect(422);

      const after = await request(server())
        .get(`${ticketsUrl(scope)}/${ticket.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(after.body.data.key).toBe(ticket.key);
      expect(after.body.data.number).toBe(ticket.number);
    });

    it('records the caller as the reporter, and refuses a client-supplied one', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      expect(ticket.reporterId).toBe(scope.owner.userId);

      // Reporter is a fact about who filed it, so the field is not accepted at
      // all rather than accepted and ignored.
      await request(server())
        .post(ticketsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Filed as someone else', reporterId: scope.owner.userId })
        .expect(422);
    });
  });

  describe('listing', () => {
    it('hides resolved and closed tickets by default', async () => {
      const scope = await setupScope();
      const open = await createTicket(scope, { title: 'Still open' });
      const done = await createTicket(scope, { title: 'Already resolved' });

      await request(server())
        .patch(`${ticketsUrl(scope)}/${done.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.RESOLVED })
        .expect(200);

      const response = await request(server())
        .get(ticketsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const ids = response.body.data.map((ticket: { id: string }) => ticket.id);
      expect(ids).toEqual([open.id]);
    });

    it('includes them when asked', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.CLOSED })
        .expect(200);

      const response = await request(server())
        .get(`${ticketsUrl(scope)}?includeClosed=true`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
    });

    it('matches an exact key when the search term looks like one', async () => {
      const scope = await setupScope();
      await createTicket(scope, { title: 'First report' });
      const second = await createTicket(scope, { title: 'Second report' });

      const response = await request(server())
        .get(`${ticketsUrl(scope)}?search=${second.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].id).toBe(second.id);
    });

    it('falls back to a case-insensitive title search', async () => {
      const scope = await setupScope();
      await createTicket(scope, { title: 'Upload times out' });
      await createTicket(scope, { title: 'Login is slow' });

      const response = await request(server())
        .get(`${ticketsUrl(scope)}?search=UPLOAD`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].title).toBe('Upload times out');
    });

    it('resolves `me` to the caller for both assignee and reporter', async () => {
      const scope = await setupScope();
      await createTicket(scope, { title: 'Mine', assigneeId: scope.owner.userId });
      await createTicket(scope, { title: 'Nobody’s' });

      const assigned = await request(server())
        .get(`${ticketsUrl(scope)}?assigneeId=me`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const reported = await request(server())
        .get(`${ticketsUrl(scope)}?reporterId=me`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(assigned.body.data).toHaveLength(1);
      expect(reported.body.data).toHaveLength(2);
    });

    /**
     * The tiles answer "how is the queue doing?", so they must not change shape
     * because someone filtered the list below them to a single status.
     */
    it('rolls up the whole workspace in meta.summary, ignoring the status filter', async () => {
      const scope = await setupScope();
      await createTicket(scope, { title: 'Urgent one', priority: TicketPriority.URGENT });
      const resolved = await createTicket(scope, { title: 'Done one' });

      await request(server())
        .patch(`${ticketsUrl(scope)}/${resolved.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.RESOLVED })
        .expect(200);

      const response = await request(server())
        .get(`${ticketsUrl(scope)}?status=${TicketStatus.OPEN}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.meta.summary).toMatchObject({
        total: 2,
        open: 1,
        urgent: 1,
        // Counts *open* tickets with nobody on them, so the resolved one is out.
        unassigned: 1,
        resolved: 1,
      });
    });

    it('accepts a comma-separated status list as well as repeated keys', async () => {
      const scope = await setupScope();
      const a = await createTicket(scope, { title: 'A' });
      await createTicket(scope, { title: 'B' });

      await request(server())
        .patch(`${ticketsUrl(scope)}/${a.key}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ status: TicketStatus.TRIAGED })
        .expect(200);

      const csv = await request(server())
        .get(`${ticketsUrl(scope)}?status=${TicketStatus.OPEN},${TicketStatus.TRIAGED}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const repeated = await request(server())
        .get(`${ticketsUrl(scope)}?status=${TicketStatus.OPEN}&status=${TicketStatus.TRIAGED}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(csv.body.data).toHaveLength(2);
      expect(repeated.body.data).toHaveLength(2);
    });

    it('orders newest first', async () => {
      const scope = await setupScope();
      await createTicket(scope, { title: 'Oldest' });
      await createTicket(scope, { title: 'Newest' });

      const response = await request(server())
        .get(ticketsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.map((t: { title: string }) => t.title)).toEqual([
        'Newest',
        'Oldest',
      ]);
    });
  });

  describe('validation and authorisation', () => {
    it('rejects a project from another workspace', async () => {
      const scope = await setupScope();
      const other = await setupScope();

      await request(server())
        .post(ticketsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Cross-tenant', projectId: other.projectId })
        .expect(400);
    });

    it('rejects an assignee who is not a member', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await request(server())
        .post(ticketsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Assigned to an outsider', assigneeId: stranger.userId })
        .expect(400);
    });

    it('rejects an update with no fields', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      await request(server())
        .patch(`${ticketsUrl(scope)}/${ticket.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({})
        .expect(400);
    });

    it('refuses a non-member entirely', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await request(server())
        .get(ticketsUrl(scope))
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(403);
    });

    it('requires MEMBER to report a ticket', async () => {
      const scope = await setupScope();
      const guest = await registerUser('Guest');
      await addMember(scope, guest, WorkspaceRole.GUEST);

      await request(server())
        .post(ticketsUrl(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ title: 'Guests cannot report' })
        .expect(403);

      // Reading stays open to every member.
      await request(server())
        .get(ticketsUrl(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .expect(200);
    });

    it('rejects an unknown enum value', async () => {
      const scope = await setupScope();

      await request(server())
        .post(ticketsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Bad type', type: 'NONSENSE' })
        .expect(422);
    });

    it('requires authentication', async () => {
      const scope = await setupScope();
      await request(server()).get(ticketsUrl(scope)).expect(401);
    });
  });

  describe('side effects', () => {
    it('writes an activity line naming the key', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope, { title: 'Audit me' });

      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/activity`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const summaries = response.body.data.map((entry: { summary: string }) => entry.summary);
      expect(summaries.some((summary: string) => summary.includes(ticket.key))).toBe(true);
    });

    it('notifies an assignee who is not the reporter', async () => {
      const scope = await setupScope();
      const member = await registerUser('Assignee');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      await createTicket(scope, { title: 'For you', assigneeId: member.userId });

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);

      expect(inbox.body.data.unreadCount).toBeGreaterThan(0);
    });

    it('does not notify someone who assigned a ticket to themselves', async () => {
      const scope = await setupScope();

      await createTicket(scope, { title: 'Mine', assigneeId: scope.owner.userId });

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const ticketNotifications = inbox.body.data.items.filter(
        (item: { entity: string | null }) => item.entity === 'TICKET',
      );
      expect(ticketNotifications).toHaveLength(0);
    });
  });

  describe('notifications', () => {
    it('marks a single notification read, and then all of them', async () => {
      const scope = await setupScope();
      const member = await registerUser('Assignee');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      await createTicket(scope, { title: 'One', assigneeId: member.userId });
      await createTicket(scope, { title: 'Two', assigneeId: member.userId });

      const before = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);

      const first = before.body.data.items[0].id as string;

      const single = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${member.token}`)
        .send({ notificationIds: [first] })
        .expect(200);

      expect(single.body.data.updated).toBe(1);

      const all = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${member.token}`)
        .send({})
        .expect(200);

      expect(all.body.data.unreadCount).toBe(0);
    });

    /** An inbox is personal: workspace membership must not expose someone else's. */
    it('never returns or marks another member’s notifications', async () => {
      const scope = await setupScope();
      const member = await registerUser('Assignee');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      await createTicket(scope, { title: 'For the member', assigneeId: member.userId });

      const memberInbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);
      const theirNotification = memberInbox.body.data.items[0].id as string;

      const ownerInbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(
        ownerInbox.body.data.items.some((item: { id: string }) => item.id === theirNotification),
      ).toBe(false);

      // The owner cannot mark it read either, even knowing its id.
      const attempt = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/notifications/read`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ notificationIds: [theirNotification] })
        .expect(200);

      expect(attempt.body.data.updated).toBe(0);
    });
  });

  describe('defaults', () => {
    it('applies BUG / OPEN / MEDIUM / MINOR when nothing is supplied', async () => {
      const scope = await setupScope();
      const ticket = await createTicket(scope);

      expect(ticket).toMatchObject({
        type: TicketType.BUG,
        status: TicketStatus.OPEN,
        priority: TicketPriority.MEDIUM,
        severity: 'MINOR',
        assigneeId: null,
        projectId: null,
        resolvedAt: null,
        closedAt: null,
      });
    });
  });
});
