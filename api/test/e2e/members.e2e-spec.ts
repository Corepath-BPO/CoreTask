import { API_PREFIX, TaskStatus, TicketStatus, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Member management (e2e)', () => {
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

  interface Scope {
    owner: Actor;
    workspaceId: string;
    projectId: string;
    sectionId: string;
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

  const membersUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/members`);

  /** Returns the membership row id, which is what the endpoints address. */
  const join = async (scope: Scope, actor: Actor, role: WorkspaceRole): Promise<string> => {
    const member = await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
    return member.id;
  };

  const ownMembershipId = async (scope: Scope, actor: Actor): Promise<string> => {
    const member = await context.prisma.workspaceMember.findUniqueOrThrow({
      where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: actor.userId } },
    });
    return member.id;
  };

  const setRole = (scope: Scope, memberId: string, actor: Actor, role: WorkspaceRole) =>
    request(server())
      .patch(`${membersUrl(scope)}/${memberId}`)
      .set('Authorization', `Bearer ${actor.token}`)
      .send({ role });

  const removeMember = (scope: Scope, memberId: string, actor: Actor) =>
    request(server())
      .delete(`${membersUrl(scope)}/${memberId}`)
      .set('Authorization', `Bearer ${actor.token}`);

  describe('listing', () => {
    it('is readable by any member, including a guest', async () => {
      const scope = await setupScope();
      const guest = await registerUser('Guest');
      await join(scope, guest, WorkspaceRole.GUEST);

      const response = await request(server())
        .get(membersUrl(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(2);
    });

    it('refuses a non-member', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await request(server())
        .get(membersUrl(scope))
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(403);
    });
  });

  describe('changing a role', () => {
    it('promotes someone below you', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      const response = await setRole(scope, memberId, scope.owner, WorkspaceRole.MANAGER).expect(
        200,
      );

      expect(response.body.data.role).toBe(WorkspaceRole.MANAGER);
    });

    it('refuses a member and a manager outright', async () => {
      const scope = await setupScope();
      const manager = await registerUser('Manager');
      const victim = await registerUser('Victim');
      await join(scope, manager, WorkspaceRole.MANAGER);
      const victimId = await join(scope, victim, WorkspaceRole.MEMBER);

      await setRole(scope, victimId, manager, WorkspaceRole.GUEST).expect(403);
    });

    /** Otherwise two admins can race to demote each other. */
    it('refuses a peer', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      const peer = await registerUser('Peer');
      await join(scope, admin, WorkspaceRole.ADMIN);
      const peerId = await join(scope, peer, WorkspaceRole.ADMIN);

      await setRole(scope, peerId, admin, WorkspaceRole.MEMBER).expect(403);
    });

    it('refuses anyone acting on the owner', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      await join(scope, admin, WorkspaceRole.ADMIN);
      const ownerId = await ownMembershipId(scope, scope.owner);

      await setRole(scope, ownerId, admin, WorkspaceRole.MEMBER).expect(403);
    });

    it('refuses acting on yourself', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      const adminId = await join(scope, admin, WorkspaceRole.ADMIN);

      await setRole(scope, adminId, admin, WorkspaceRole.GUEST).expect(403);
    });

    it('refuses granting a role above your own', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      const member = await registerUser('Member');
      await join(scope, admin, WorkspaceRole.ADMIN);
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      await setRole(scope, memberId, admin, WorkspaceRole.OWNER).expect(403);
    });

    it('allows granting your own role', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      const member = await registerUser('Member');
      await join(scope, admin, WorkspaceRole.ADMIN);
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      await setRole(scope, memberId, admin, WorkspaceRole.ADMIN).expect(200);
      // …and having done so, can no longer act on them: they are peers now.
      await setRole(scope, memberId, admin, WorkspaceRole.MEMBER).expect(403);
    });

    it('never assigns OWNER, even from the owner', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      await setRole(scope, memberId, scope.owner, WorkspaceRole.OWNER).expect(403);
    });

    it('takes effect immediately, without waiting for a new token', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      // A member cannot list invitations; an admin can. Same token throughout.
      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/invitations`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);

      await setRole(scope, memberId, scope.owner, WorkspaceRole.ADMIN).expect(200);

      await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/invitations`))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(200);
    });

    it('records the change', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      await setRole(scope, memberId, scope.owner, WorkspaceRole.MANAGER).expect(200);

      const audit = await context.prisma.activityLog.findMany({
        where: { workspaceId: scope.workspaceId, action: 'MEMBER_ROLE_CHANGED' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.metadata).toMatchObject({ from: 'MEMBER', to: 'MANAGER' });
    });

    it('404s an unknown member', async () => {
      const scope = await setupScope();

      await setRole(
        scope,
        '019fc8d5-0000-7000-8000-000000000000',
        scope.owner,
        WorkspaceRole.MEMBER,
      ).expect(404);
    });

    it('will not reach into another workspace', async () => {
      const first = await setupScope();
      const second = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(first, member, WorkspaceRole.MEMBER);

      await request(server())
        .patch(url(`/workspaces/${second.workspaceId}/members/${memberId}`))
        .set('Authorization', `Bearer ${second.owner.token}`)
        .send({ role: WorkspaceRole.ADMIN })
        .expect(404);
    });
  });

  describe('removing and leaving', () => {
    it('removes someone below you and ends their access at once', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      await removeMember(scope, memberId, scope.owner).expect(200);

      await request(server())
        .get(membersUrl(scope))
        .set('Authorization', `Bearer ${member.token}`)
        .expect(403);
    });

    it('lets someone leave without any particular role', async () => {
      const scope = await setupScope();
      const guest = await registerUser('Guest');
      const guestId = await join(scope, guest, WorkspaceRole.GUEST);

      await removeMember(scope, guestId, guest).expect(200);
    });

    it('refuses removing a peer', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      const peer = await registerUser('Peer');
      await join(scope, admin, WorkspaceRole.ADMIN);
      const peerId = await join(scope, peer, WorkspaceRole.ADMIN);

      await removeMember(scope, peerId, admin).expect(403);
    });

    it('refuses a member removing anyone', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const other = await registerUser('Other');
      await join(scope, member, WorkspaceRole.MEMBER);
      const otherId = await join(scope, other, WorkspaceRole.GUEST);

      await removeMember(scope, otherId, member).expect(403);
    });

    /** A workspace with no owner has nobody who can ever transfer it. */
    it('refuses to remove the owner', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      await join(scope, admin, WorkspaceRole.ADMIN);
      const ownerId = await ownMembershipId(scope, scope.owner);

      await removeMember(scope, ownerId, admin).expect(400);
    });

    it('refuses to let the owner leave', async () => {
      const scope = await setupScope();
      const ownerId = await ownMembershipId(scope, scope.owner);

      await removeMember(scope, ownerId, scope.owner).expect(400);
    });

    /**
     * Assignment points at a user rather than a membership, so nothing in the
     * schema clears it — the board would go on showing work assigned to someone
     * who can no longer open it.
     */
    it('unassigns their open tasks and tickets', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      const task = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Open work', sectionId: scope.sectionId, assigneeId: member.userId })
        .expect(201);

      const ticket = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tickets`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ title: 'Open ticket', assigneeId: member.userId })
        .expect(201);

      const response = await removeMember(scope, memberId, scope.owner).expect(200);

      expect(response.body.data).toMatchObject({
        removed: true,
        tasksUnassigned: 1,
        ticketsUnassigned: 1,
      });

      const afterTask = await context.prisma.task.findUniqueOrThrow({
        where: { id: task.body.data.id },
      });
      const afterTicket = await context.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.body.data.id },
      });
      expect(afterTask.assigneeId).toBeNull();
      expect(afterTicket.assigneeId).toBeNull();
    });

    /** Finished work records who did it; rewriting that would falsify history. */
    it('leaves completed work attributed to them', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      const task = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          title: 'Finished work',
          sectionId: scope.sectionId,
          assigneeId: member.userId,
          status: TaskStatus.DONE,
        })
        .expect(201);

      const response = await removeMember(scope, memberId, scope.owner).expect(200);
      expect(response.body.data.tasksUnassigned).toBe(0);

      const after = await context.prisma.task.findUniqueOrThrow({
        where: { id: task.body.data.id },
      });
      expect(after.assigneeId).toBe(member.userId);
    });

    it('leaves a closed ticket attributed to them', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      const ticket = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tickets`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          title: 'Closed ticket',
          assigneeId: member.userId,
          status: TicketStatus.CLOSED,
        })
        .expect(201);

      await removeMember(scope, memberId, scope.owner).expect(200);

      const after = await context.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.body.data.id },
      });
      expect(after.assigneeId).toBe(member.userId);
    });

    it('keeps the tickets they reported, because that is a fact', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      const ticket = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tickets`))
        .set('Authorization', `Bearer ${member.token}`)
        .send({ title: 'Reported by the departing member' })
        .expect(201);

      await removeMember(scope, memberId, scope.owner).expect(200);

      const after = await context.prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.body.data.id },
      });
      expect(after.reporterId).toBe(member.userId);
    });

    it('records who left and who was removed', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);

      await removeMember(scope, memberId, scope.owner).expect(200);

      const audit = await context.prisma.activityLog.findMany({
        where: { workspaceId: scope.workspaceId, action: 'MEMBER_REMOVED' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]?.summary).toContain('Removed a member');
    });
  });

  describe('transferring ownership', () => {
    it('swaps the roles in one step', async () => {
      const scope = await setupScope();
      const successor = await registerUser('Successor');
      const successorId = await join(scope, successor, WorkspaceRole.MEMBER);

      const response = await request(server())
        .post(`${membersUrl(scope)}/${successorId}/transfer-ownership`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.role).toBe(WorkspaceRole.OWNER);

      const previous = await context.prisma.workspaceMember.findUniqueOrThrow({
        where: {
          workspaceId_userId: { workspaceId: scope.workspaceId, userId: scope.owner.userId },
        },
      });
      expect(previous.role).toBe(WorkspaceRole.ADMIN);
    });

    /** There must always be exactly one owner, at every instant. */
    it('leaves the workspace with exactly one owner', async () => {
      const scope = await setupScope();
      const successor = await registerUser('Successor');
      const successorId = await join(scope, successor, WorkspaceRole.MEMBER);

      await request(server())
        .post(`${membersUrl(scope)}/${successorId}/transfer-ownership`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const owners = await context.prisma.workspaceMember.count({
        where: { workspaceId: scope.workspaceId, role: WorkspaceRole.OWNER },
      });
      expect(owners).toBe(1);
    });

    it('refuses anyone but the owner', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      const target = await registerUser('Target');
      await join(scope, admin, WorkspaceRole.ADMIN);
      const targetId = await join(scope, target, WorkspaceRole.MEMBER);

      await request(server())
        .post(`${membersUrl(scope)}/${targetId}/transfer-ownership`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(403);
    });

    it('refuses transferring to yourself', async () => {
      const scope = await setupScope();
      const ownerId = await ownMembershipId(scope, scope.owner);

      await request(server())
        .post(`${membersUrl(scope)}/${ownerId}/transfer-ownership`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);
    });

    it('lets the outgoing owner leave afterwards', async () => {
      const scope = await setupScope();
      const successor = await registerUser('Successor');
      const successorId = await join(scope, successor, WorkspaceRole.MEMBER);
      const ownerId = await ownMembershipId(scope, scope.owner);

      await removeMember(scope, ownerId, scope.owner).expect(400);

      await request(server())
        .post(`${membersUrl(scope)}/${successorId}/transfer-ownership`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      await removeMember(scope, ownerId, scope.owner).expect(200);
    });

    it('notifies the new owner', async () => {
      const scope = await setupScope();
      const successor = await registerUser('Successor');
      const successorId = await join(scope, successor, WorkspaceRole.MEMBER);

      await request(server())
        .post(`${membersUrl(scope)}/${successorId}/transfer-ownership`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${successor.token}`)
        .expect(200);

      expect(
        inbox.body.data.items.some((item: { title: string }) => item.title.includes('now own')),
      ).toBe(true);
    });
  });
});
