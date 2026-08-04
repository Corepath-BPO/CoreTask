import { API_PREFIX, TaskStatus, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Teams (e2e)', () => {
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

    return { owner, workspaceId: workspace.body.data.id as string };
  };

  const join = async (scope: Scope, actor: Actor, role: WorkspaceRole): Promise<string> => {
    const member = await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: actor.userId, role },
    });
    return member.id;
  };

  const teamsUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/teams`);

  const createTeam = (scope: Scope, actor: Actor, body: Record<string, unknown>) =>
    request(server())
      .post(teamsUrl(scope))
      .set('Authorization', `Bearer ${actor.token}`)
      .send(body);

  /** Creates a team as the owner and returns its id. */
  const seedTeam = async (scope: Scope, body: Record<string, unknown> = {}): Promise<string> => {
    const response = await createTeam(scope, scope.owner, { name: 'Platform', ...body }).expect(201);
    return response.body.data.id as string;
  };

  const createProject = async (
    scope: Scope,
    body: Record<string, unknown> = {},
  ): Promise<{ id: string; sectionId: string }> => {
    const response = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/projects`))
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .send({ name: 'Platform Foundation', ...body })
      .expect(201);

    return {
      id: response.body.data.id as string,
      sectionId: response.body.data.sections[0].id as string,
    };
  };

  describe('listing and reading', () => {
    it('is open to any member, including a guest', async () => {
      const scope = await setupScope();
      await seedTeam(scope);
      const guest = await registerUser('Guest');
      await join(scope, guest, WorkspaceRole.GUEST);

      const response = await request(server())
        .get(teamsUrl(scope))
        .set('Authorization', `Bearer ${guest.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].name).toBe('Platform');
    });

    it('refuses a non-member', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await request(server())
        .get(teamsUrl(scope))
        .set('Authorization', `Bearer ${stranger.token}`)
        .expect(403);
    });

    it('does not reach across workspaces', async () => {
      const scope = await setupScope();
      const teamId = await seedTeam(scope);
      const other = await setupScope();

      await request(server())
        .get(`${teamsUrl(other)}/${teamId}`)
        .set('Authorization', `Bearer ${other.owner.token}`)
        .expect(404);
    });
  });

  describe('creating', () => {
    it('requires ADMIN', async () => {
      const scope = await setupScope();
      const manager = await registerUser('Manager');
      await join(scope, manager, WorkspaceRole.MANAGER);

      await createTeam(scope, manager, { name: 'Platform' }).expect(403);
    });

    it('rejects a duplicate name within the workspace', async () => {
      const scope = await setupScope();
      await seedTeam(scope);

      await createTeam(scope, scope.owner, { name: 'Platform' }).expect(409);
    });

    it('allows the same name in a different workspace', async () => {
      const scope = await setupScope();
      await seedTeam(scope);
      const other = await setupScope();

      await createTeam(other, other.owner, { name: 'Platform' }).expect(201);
    });

    it('refuses a lead who is not a workspace member', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      await createTeam(scope, scope.owner, {
        name: 'Platform',
        leadId: stranger.userId,
      }).expect(400);
    });

    it('adds the lead to the team it puts them in charge of', async () => {
      const scope = await setupScope();

      const response = await createTeam(scope, scope.owner, {
        name: 'Platform',
        leadId: scope.owner.userId,
      }).expect(201);

      expect(response.body.data.leadId).toBe(scope.owner.userId);
      expect(response.body.data.memberCount).toBe(1);
    });
  });

  describe('editing', () => {
    it('lets the team lead edit without being an admin', async () => {
      const scope = await setupScope();
      const lead = await registerUser('Lead');
      await join(scope, lead, WorkspaceRole.MEMBER);
      const teamId = await seedTeam(scope, { leadId: lead.userId });

      const response = await request(server())
        .patch(`${teamsUrl(scope)}/${teamId}`)
        .set('Authorization', `Bearer ${lead.token}`)
        .send({ name: 'Platform Core' })
        .expect(200);

      expect(response.body.data.name).toBe('Platform Core');
    });

    it('refuses a member who is neither admin nor lead', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await join(scope, member, WorkspaceRole.MANAGER);
      const teamId = await seedTeam(scope);

      await request(server())
        .patch(`${teamsUrl(scope)}/${teamId}`)
        .set('Authorization', `Bearer ${member.token}`)
        .send({ name: 'Platform Core' })
        .expect(403);
    });

    it('rejects an empty patch', async () => {
      const scope = await setupScope();
      const teamId = await seedTeam(scope);

      await request(server())
        .patch(`${teamsUrl(scope)}/${teamId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({})
        .expect(400);
    });

    it('stands the lead down when set to null', async () => {
      const scope = await setupScope();
      const teamId = await seedTeam(scope, { leadId: scope.owner.userId });

      const response = await request(server())
        .patch(`${teamsUrl(scope)}/${teamId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ leadId: null })
        .expect(200);

      expect(response.body.data.leadId).toBeNull();
      // Standing down is not the same as leaving: they stay on the roster.
      expect(response.body.data.memberCount).toBe(1);
    });
  });

  describe('membership', () => {
    it('adds a workspace member and is idempotent', async () => {
      const scope = await setupScope();
      const teamId = await seedTeam(scope);
      const member = await registerUser('Member');
      await join(scope, member, WorkspaceRole.MEMBER);

      const first = await request(server())
        .post(`${teamsUrl(scope)}/${teamId}/members`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userId: member.userId })
        .expect(200);
      expect(first.body.data.memberCount).toBe(1);

      const second = await request(server())
        .post(`${teamsUrl(scope)}/${teamId}/members`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userId: member.userId })
        .expect(200);
      expect(second.body.data.memberCount).toBe(1);
    });

    it('refuses someone who is not in the workspace', async () => {
      const scope = await setupScope();
      const teamId = await seedTeam(scope);
      const stranger = await registerUser('Stranger');

      await request(server())
        .post(`${teamsUrl(scope)}/${teamId}/members`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userId: stranger.userId })
        .expect(400);
    });

    it('clears the appointment when the lead is removed from the roster', async () => {
      const scope = await setupScope();
      const lead = await registerUser('Lead');
      await join(scope, lead, WorkspaceRole.MEMBER);
      const teamId = await seedTeam(scope, { leadId: lead.userId });

      const response = await request(server())
        .delete(`${teamsUrl(scope)}/${teamId}/members/${lead.userId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.leadId).toBeNull();
      expect(response.body.data.memberCount).toBe(0);
    });
  });

  describe('deleting', () => {
    it('requires ADMIN — a lead may run a team but not dissolve it', async () => {
      const scope = await setupScope();
      const lead = await registerUser('Lead');
      await join(scope, lead, WorkspaceRole.MEMBER);
      const teamId = await seedTeam(scope, { leadId: lead.userId });

      await request(server())
        .delete(`${teamsUrl(scope)}/${teamId}`)
        .set('Authorization', `Bearer ${lead.token}`)
        .expect(403);
    });

    it('leaves the team’s projects standing, unassigned', async () => {
      const scope = await setupScope();
      const teamId = await seedTeam(scope);
      const project = await createProject(scope, { teamId });

      await request(server())
        .delete(`${teamsUrl(scope)}/${teamId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(204);

      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/projects/${project.id}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data.teamId).toBeNull();
      expect(response.body.data.team).toBeNull();
    });
  });

  describe('project association', () => {
    it('rejects a team belonging to another workspace', async () => {
      const scope = await setupScope();
      const other = await setupScope();
      const foreignTeam = await seedTeam(other);

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Platform Foundation', teamId: foreignTeam })
        .expect(400);
    });

    it('filters the project list by team', async () => {
      const scope = await setupScope();
      const teamId = await seedTeam(scope);
      await createProject(scope, { name: 'Owned', key: 'OWN', teamId });
      await createProject(scope, { name: 'Unowned', key: 'UNOWN' });

      const response = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/projects?teamId=${teamId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0].key).toBe('OWN');
      expect(response.body.data[0].team.name).toBe('Platform');
    });
  });

  /*
   * The consistency rule that has no natural home in either module: team
   * membership points at a *user*, so nothing in the schema clears it when a
   * workspace membership ends. Left alone, the roster would keep showing people
   * who can no longer open anything the team works on.
   */
  describe('leaving the workspace', () => {
    it('drops the person from that workspace’s teams', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);
      const teamId = await seedTeam(scope);

      await request(server())
        .post(`${teamsUrl(scope)}/${teamId}/members`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userId: member.userId })
        .expect(200);

      const removal = await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/members/${memberId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(removal.body.data.teamsLeft).toBe(1);

      const team = await request(server())
        .get(`${teamsUrl(scope)}/${teamId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(team.body.data.members).toHaveLength(0);
    });

    it('stands them down as lead too', async () => {
      const scope = await setupScope();
      const lead = await registerUser('Lead');
      const memberId = await join(scope, lead, WorkspaceRole.MEMBER);
      const teamId = await seedTeam(scope, { leadId: lead.userId });

      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/members/${memberId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const team = await request(server())
        .get(`${teamsUrl(scope)}/${teamId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(team.body.data.leadId).toBeNull();
      expect(team.body.data.lead).toBeNull();
    });

    it('leaves their teams in other workspaces alone', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);
      const teamId = await seedTeam(scope);
      await request(server())
        .post(`${teamsUrl(scope)}/${teamId}/members`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ userId: member.userId })
        .expect(200);

      const other = await setupScope();
      await join(other, member, WorkspaceRole.MEMBER);
      const otherTeamId = await seedTeam(other);
      await request(server())
        .post(`${teamsUrl(other)}/${otherTeamId}/members`)
        .set('Authorization', `Bearer ${other.owner.token}`)
        .send({ userId: member.userId })
        .expect(200);

      await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/members/${memberId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const survivor = await request(server())
        .get(`${teamsUrl(other)}/${otherTeamId}`)
        .set('Authorization', `Bearer ${other.owner.token}`)
        .expect(200);

      expect(survivor.body.data.members).toHaveLength(1);
    });

    it('still unassigns open work, as it did before teams existed', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      const memberId = await join(scope, member, WorkspaceRole.MEMBER);
      const project = await createProject(scope);

      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          projectId: project.id,
          sectionId: project.sectionId,
          title: 'Open work',
          status: TaskStatus.IN_PROGRESS,
          assigneeId: member.userId,
        })
        .expect(201);

      const removal = await request(server())
        .delete(url(`/workspaces/${scope.workspaceId}/members/${memberId}`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(removal.body.data.tasksUnassigned).toBe(1);
      expect(removal.body.data.teamsLeft).toBe(0);
    });
  });
});
