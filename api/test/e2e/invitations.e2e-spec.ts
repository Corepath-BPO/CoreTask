import { createHash } from 'node:crypto';

import { API_PREFIX, INVITATION_EXPIRY_DAYS, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Invitations (e2e)', () => {
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
  }

  const registerUser = async (name = 'Test User', email = uniqueEmail()): Promise<Actor> => {
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
    const owner = await registerUser();

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Acme Product' })
      .expect(201);

    return { owner, workspaceId: workspace.body.data.id as string };
  };

  const addMember = async (scope: Scope, actor: Actor, role: WorkspaceRole) => {
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
  };

  const invitationsUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/invitations`);

  const invite = async (
    scope: Scope,
    email: string,
    role: WorkspaceRole = WorkspaceRole.MEMBER,
    actor?: Actor,
  ) => {
    const response = await request(server())
      .post(invitationsUrl(scope))
      .set('Authorization', `Bearer ${(actor ?? scope.owner).token}`)
      .send({ email, role })
      .expect(201);

    return response.body.data;
  };

  /**
   * The raw token exists only in the e-mail, which the test cannot read. Setting
   * a known hash directly is the least invasive way to obtain a usable link —
   * and it exercises the same lookup the real token takes.
   */
  const setToken = async (invitationId: string, token: string) => {
    await context.prisma.workspaceInvitation.update({
      where: { id: invitationId },
      data: { tokenHash: createHash('sha256').update(token).digest('hex') },
    });
    return token;
  };

  describe('inviting', () => {
    it('creates a pending invitation and normalises the address', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'Ada@Example.COM');

      expect(invitation).toMatchObject({
        email: 'ada@example.com',
        role: WorkspaceRole.MEMBER,
        expired: false,
      });
      expect(invitation.invitedBy.id).toBe(scope.owner.userId);
    });

    /** The token is the credential; listing it would let any admin impersonate. */
    it('never returns the token', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');

      expect(invitation).not.toHaveProperty('token');
      expect(invitation).not.toHaveProperty('tokenHash');

      const list = await request(server())
        .get(invitationsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(JSON.stringify(list.body)).not.toContain('tokenHash');
    });

    it('expires a week out', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');

      const days = (new Date(invitation.expiresAt).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(INVITATION_EXPIRY_DAYS - 1);
      expect(days).toBeLessThanOrEqual(INVITATION_EXPIRY_DAYS);
    });

    /**
     * Re-inviting is also "resend" and "change their role before they accept",
     * so it refreshes one row instead of stacking offers — which is what stops a
     * revoked link surviving alongside a fresh one.
     */
    it('refreshes the existing invitation rather than creating a second', async () => {
      const scope = await setupScope();
      const first = await invite(scope, 'ada@example.com', WorkspaceRole.GUEST);
      const second = await invite(scope, 'ada@example.com', WorkspaceRole.MANAGER);

      expect(second.id).toBe(first.id);
      expect(second.role).toBe(WorkspaceRole.MANAGER);

      const list = await request(server())
        .get(invitationsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(list.body.data).toHaveLength(1);
    });

    it('invalidates the previous link when an invitation is refreshed', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');
      const stale = await setToken(invitation.id, 'stale-token-value');

      await invite(scope, 'ada@example.com');

      await request(server())
        .get(url(`/invitations/${stale}`))
        .expect(404);
    });

    it('rejects an address that is already a member', async () => {
      const scope = await setupScope();

      await request(server())
        .post(invitationsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ email: scope.owner.email, role: WorkspaceRole.MEMBER })
        .expect(409);
    });

    it('rejects a malformed address', async () => {
      const scope = await setupScope();

      await request(server())
        .post(invitationsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ email: 'not-an-address', role: WorkspaceRole.MEMBER })
        .expect(422);
    });
  });

  describe('who may invite, and at what role', () => {
    it('refuses a member', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await addMember(scope, member, WorkspaceRole.MEMBER);

      await request(server())
        .post(invitationsUrl(scope))
        .set('Authorization', `Bearer ${member.token}`)
        .send({ email: 'ada@example.com', role: WorkspaceRole.MEMBER })
        .expect(403);
    });

    it('refuses a manager, who is below ADMIN', async () => {
      const scope = await setupScope();
      const manager = await registerUser('Manager');
      await addMember(scope, manager, WorkspaceRole.MANAGER);

      await request(server())
        .post(invitationsUrl(scope))
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ email: 'ada@example.com', role: WorkspaceRole.GUEST })
        .expect(403);
    });

    /** Otherwise privilege escalation is one invitation away. */
    it('refuses an admin trying to grant a role above their own', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      await addMember(scope, admin, WorkspaceRole.ADMIN);

      await request(server())
        .post(invitationsUrl(scope))
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ email: 'ada@example.com', role: WorkspaceRole.OWNER })
        .expect(403);
    });

    it('refuses OWNER even from the owner, because that is a transfer', async () => {
      const scope = await setupScope();

      await request(server())
        .post(invitationsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ email: 'ada@example.com', role: WorkspaceRole.OWNER })
        .expect(403);
    });

    it('lets an admin grant their own role and below', async () => {
      const scope = await setupScope();
      const admin = await registerUser('Admin');
      await addMember(scope, admin, WorkspaceRole.ADMIN);

      await invite(scope, 'peer@example.com', WorkspaceRole.ADMIN, admin);
      await invite(scope, 'junior@example.com', WorkspaceRole.GUEST, admin);
    });

    it('refuses a non-member entirely', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await request(server())
        .get(invitationsUrl(scope))
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(403);
    });
  });

  describe('preview', () => {
    it('is readable without a session, and names the workspace', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');
      const token = await setToken(invitation.id, 'preview-token');

      const response = await request(server())
        .get(url(`/invitations/${token}`))
        .expect(200);

      expect(response.body.data).toMatchObject({
        workspaceName: 'Acme Product',
        email: 'ada@example.com',
        role: WorkspaceRole.MEMBER,
      });
    });

    /** Whoever holds a link is not a member; they get context, nothing more. */
    it('exposes nothing about the workspace beyond its name', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');
      const token = await setToken(invitation.id, 'thin-preview-token');

      const response = await request(server())
        .get(url(`/invitations/${token}`))
        .expect(200);

      /*
       * An exhaustive list, so widening the preview has to be a deliberate edit
       * here rather than something that slips out with a new field on the model.
       * `teamName` is the only addition since: a name, on the same footing as
       * the role — material to deciding whether to accept, and saying nothing
       * about the workspace's people.
       */
      expect(Object.keys(response.body.data).sort()).toEqual([
        'email',
        'expiresAt',
        'invitedByName',
        'role',
        'teamName',
        'workspaceName',
      ]);
    });

    it('reports no team when the invitation named none', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');
      const token = await setToken(invitation.id, 'no-team-token');

      const response = await request(server())
        .get(url(`/invitations/${token}`))
        .expect(200);

      expect(response.body.data.teamName).toBeNull();
    });

    it('404s an unknown token', async () => {
      await request(server()).get(url('/invitations/nothing-like-a-real-token')).expect(404);
    });
  });

  describe('accepting', () => {
    it('joins the workspace at the invited role', async () => {
      const scope = await setupScope();
      const email = uniqueEmail();
      const invitation = await invite(scope, email, WorkspaceRole.MANAGER);
      const token = await setToken(invitation.id, 'accept-token');

      const invitee = await registerUser('Invitee', email);

      const response = await request(server())
        .post(url(`/invitations/${token}/accept`))
        .set('Authorization', `Bearer ${invitee.token}`)
        .expect(200);

      expect(response.body.data).toMatchObject({
        workspaceId: scope.workspaceId,
        role: WorkspaceRole.MANAGER,
      });

      const membership = await context.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId: scope.workspaceId, userId: invitee.userId } },
      });
      expect(membership?.role).toBe(WorkspaceRole.MANAGER);
      expect(membership?.invitedById).toBe(scope.owner.userId);
    });

    /**
     * Without this, forwarding the e-mail hands the workspace to whoever opens
     * it, and the invitation stops being a statement about *who* was invited.
     */
    it('refuses an account whose address does not match', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'intended@example.com');
      const token = await setToken(invitation.id, 'mismatch-token');

      const someoneElse = await registerUser('Someone Else');

      await request(server())
        .post(url(`/invitations/${token}/accept`))
        .set('Authorization', `Bearer ${someoneElse.token}`)
        .expect(403);

      const members = await context.prisma.workspaceMember.count({
        where: { workspaceId: scope.workspaceId },
      });
      expect(members).toBe(1);
    });

    it('matches the address case-insensitively', async () => {
      const scope = await setupScope();
      const email = `Mixed.Case.${Date.now()}@Example.com`;
      const invitation = await invite(scope, email);
      const token = await setToken(invitation.id, 'case-token');

      const invitee = await registerUser('Invitee', email.toLowerCase());

      await request(server())
        .post(url(`/invitations/${token}/accept`))
        .set('Authorization', `Bearer ${invitee.token}`)
        .expect(200);
    });

    it('requires a session', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');
      const token = await setToken(invitation.id, 'anonymous-token');

      await request(server())
        .post(url(`/invitations/${token}/accept`))
        .expect(401);
    });

    it('cannot be used twice', async () => {
      const scope = await setupScope();
      const email = uniqueEmail();
      const invitation = await invite(scope, email);
      const token = await setToken(invitation.id, 'single-use-token');
      const invitee = await registerUser('Invitee', email);

      await request(server())
        .post(url(`/invitations/${token}/accept`))
        .set('Authorization', `Bearer ${invitee.token}`)
        .expect(200);

      await request(server())
        .post(url(`/invitations/${token}/accept`))
        .set('Authorization', `Bearer ${invitee.token}`)
        .expect(404);
    });

    it('refuses an expired invitation', async () => {
      const scope = await setupScope();
      const email = uniqueEmail();
      const invitation = await invite(scope, email);
      const token = await setToken(invitation.id, 'expired-token');
      const invitee = await registerUser('Invitee', email);

      await context.prisma.workspaceInvitation.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      await request(server())
        .post(url(`/invitations/${token}/accept`))
        .set('Authorization', `Bearer ${invitee.token}`)
        .expect(404);
    });

    it('drops out of the pending list once accepted', async () => {
      const scope = await setupScope();
      const email = uniqueEmail();
      const invitation = await invite(scope, email);
      const token = await setToken(invitation.id, 'accepted-token');
      const invitee = await registerUser('Invitee', email);

      await request(server())
        .post(url(`/invitations/${token}/accept`))
        .set('Authorization', `Bearer ${invitee.token}`)
        .expect(200);

      const list = await request(server())
        .get(invitationsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(list.body.data).toHaveLength(0);
    });

    it('notifies whoever sent the invitation', async () => {
      const scope = await setupScope();
      const email = uniqueEmail();
      const invitation = await invite(scope, email);
      const token = await setToken(invitation.id, 'notify-token');
      const invitee = await registerUser('Invitee', email);

      await request(server())
        .post(url(`/invitations/${token}/accept`))
        .set('Authorization', `Bearer ${invitee.token}`)
        .expect(200);

      const inbox = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/notifications`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const accepted = inbox.body.data.items.filter((item: { title: string }) =>
        item.title.includes('accepted'),
      );
      expect(accepted).toHaveLength(1);
    });
  });

  describe('revoking', () => {
    it('stops the link working', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');
      const token = await setToken(invitation.id, 'revoked-token');

      await request(server())
        .delete(`${invitationsUrl(scope)}/${invitation.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(204);

      await request(server())
        .get(url(`/invitations/${token}`))
        .expect(404);
    });

    it('drops it from the pending list', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');

      await request(server())
        .delete(`${invitationsUrl(scope)}/${invitation.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(204);

      const list = await request(server())
        .get(invitationsUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(list.body.data).toHaveLength(0);
    });

    it('cannot be revoked twice', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');
      const revokeUrl = `${invitationsUrl(scope)}/${invitation.id}`;

      await request(server())
        .delete(revokeUrl)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(204);

      await request(server())
        .delete(revokeUrl)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });

    it('will not reach into another workspace', async () => {
      const first = await setupScope();
      const second = await setupScope();
      const invitation = await invite(first, 'ada@example.com');

      await request(server())
        .delete(url(`/workspaces/${second.workspaceId}/invitations/${invitation.id}`))
        .set('Authorization', `Bearer ${second.owner.token}`)
        .expect(404);
    });

    /** A revoked address can be invited again — that is the same refresh path. */
    it('allows re-inviting after a revoke', async () => {
      const scope = await setupScope();
      const invitation = await invite(scope, 'ada@example.com');

      await request(server())
        .delete(`${invitationsUrl(scope)}/${invitation.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(204);

      const reissued = await invite(scope, 'ada@example.com');
      const token = await setToken(reissued.id, 'reissued-token');

      await request(server())
        .get(url(`/invitations/${token}`))
        .expect(200);
    });
  });
});
