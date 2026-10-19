import { randomUUID } from 'node:crypto';

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
 * Portfolios on the server: shared across the workspace, filtered by project
 * visibility, starred per person, and changed only by their owner or a manager.
 */
describe('Portfolios (e2e)', () => {
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

  const setup = async () => {
    const owner = await registerUser('Ada Owner');
    const member = await registerUser('Bea Member');
    const guest = await registerUser('Cy Guest');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    await context.prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
        { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
      ],
    });

    const project = async (name: string, visibility?: 'PRIVATE') =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/projects`))
          .set(as(owner))
          .send({ name, ...(visibility ? { visibility } : {}) })
          .expect(201)
      ).body.data.id as string;

    return {
      owner,
      member,
      guest,
      workspaceId,
      publicProjectId: await project('Leasing'),
      privateProjectId: await project('Board pack', 'PRIVATE'),
    };
  };

  type Scope = Awaited<ReturnType<typeof setup>>;
  const portfolios = (scope: Scope, path = '') =>
    url(`/workspaces/${scope.workspaceId}/portfolios${path}`);

  const create = async (scope: Scope, actor: Actor) =>
    (
      await request(server())
        .post(portfolios(scope))
        .set(as(actor))
        .send({ name: 'Programme', description: 'All of it', color: '#6366F1' })
        .expect(201)
    ).body.data as { id: string; projectIds: string[] };

  it('is shared with the workspace, but each reader sees only projects they can open', async () => {
    const scope = await setup();
    const portfolio = await create(scope, scope.owner);

    const added = await request(server())
      .post(portfolios(scope, `/${portfolio.id}/projects`))
      .set(as(scope.owner))
      .send({ projectIds: [scope.publicProjectId, scope.privateProjectId] })
      .expect(201);
    expect(added.body.data.projectIds).toEqual([scope.publicProjectId, scope.privateProjectId]);

    const seenByMember = await request(server())
      .get(portfolios(scope))
      .set(as(scope.member))
      .expect(200);
    expect(seenByMember.body.data).toEqual([
      expect.objectContaining({
        id: portfolio.id,
        name: 'Programme',
        projectIds: [scope.publicProjectId],
        owner: expect.objectContaining({ name: 'Ada Owner' }),
      }),
    ]);
  });

  it('will not add a project the caller cannot open', async () => {
    const scope = await setup();
    const portfolio = await create(scope, scope.member);

    await request(server())
      .post(portfolios(scope, `/${portfolio.id}/projects`))
      .set(as(scope.member))
      .send({ projectIds: [scope.privateProjectId] })
      .expect(404);
    await request(server())
      .post(portfolios(scope, `/${portfolio.id}/projects`))
      .set(as(scope.member))
      .send({ projectIds: [randomUUID()] })
      .expect(404);
  });

  it('stars per person', async () => {
    const scope = await setup();
    const portfolio = await create(scope, scope.owner);

    const starred = await request(server())
      .put(portfolios(scope, `/${portfolio.id}/star`))
      .set(as(scope.member))
      .send({ starred: true })
      .expect(200);
    expect(starred.body.data.starred).toBe(true);

    const ownersView = await request(server())
      .get(portfolios(scope))
      .set(as(scope.owner))
      .expect(200);
    expect(ownersView.body.data[0].starred).toBe(false);
  });

  it('lets only its owner or a manager change it, and guests none', async () => {
    const scope = await setup();
    const portfolio = await create(scope, scope.owner);

    await request(server())
      .patch(portfolios(scope, `/${portfolio.id}`))
      .set(as(scope.member))
      .send({ name: 'Mine now' })
      .expect(403);
    await request(server())
      .post(portfolios(scope))
      .set(as(scope.guest))
      .send({ name: 'Guest portfolio', color: '#6366F1' })
      .expect(403);

    const renamed = await request(server())
      .patch(portfolios(scope, `/${portfolio.id}`))
      .set(as(scope.owner))
      .send({ name: 'Leasing programme' })
      .expect(200);
    expect(renamed.body.data.name).toBe('Leasing programme');

    await request(server())
      .delete(portfolios(scope, `/${portfolio.id}`))
      .set(as(scope.member))
      .expect(403);
    await request(server())
      .delete(portfolios(scope, `/${portfolio.id}`))
      .set(as(scope.owner))
      .expect(204);
    // The projects are untouched.
    expect(await context.prisma.project.count({ where: { workspaceId: scope.workspaceId } })).toBe(
      2,
    );
  });

  it('holds a conversation: members post and reply, guests read, the right people hear', async () => {
    const scope = await setup();
    const portfolio = await create(scope, scope.owner);
    const messages = portfolios(scope, `/${portfolio.id}/messages`);

    // The member follows the portfolio by its star.
    await request(server())
      .put(portfolios(scope, `/${portfolio.id}/star`))
      .set(as(scope.member))
      .send({ starred: true })
      .expect(200);
    const before = await context.prisma.notification.count();

    const posted = await request(server())
      .post(messages)
      .set(as(scope.owner))
      .send({ title: 'Q4 priorities', body: '<p>Leasing first, then the board pack.</p>' })
      .expect(201);
    const messageId = posted.body.data.id as string;
    expect(posted.body.data).toMatchObject({
      portfolioId: portfolio.id,
      title: 'Q4 priorities',
      author: expect.objectContaining({ name: 'Ada Owner' }),
      replies: [],
    });
    // The owner posted, so only the member who starred it is told.
    const told = await context.prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
    expect(told.slice(before).map((row) => [row.userId, row.actionUrl])).toEqual([
      [scope.member.userId, `/portfolios/${portfolio.id}/messages`],
    ]);

    const replied = await request(server())
      .post(`${messages}/${messageId}/replies`)
      .set(as(scope.member))
      .send({ body: 'Agreed.' })
      .expect(201);
    expect(replied.body.data.replies).toEqual([
      expect.objectContaining({
        body: '<p>Agreed.</p>',
        author: expect.objectContaining({ name: 'Bea Member' }),
      }),
    ]);

    const read = await request(server()).get(messages).set(as(scope.guest)).expect(200);
    expect(read.body.data).toHaveLength(1);
    await request(server())
      .post(messages)
      .set(as(scope.guest))
      .send({ title: 'Me too', body: 'Hi' })
      .expect(403);

    // Only its author, or a manager, deletes it.
    await request(server()).delete(`${messages}/${messageId}`).set(as(scope.member)).expect(403);
    await request(server()).delete(`${messages}/${messageId}`).set(as(scope.owner)).expect(204);
    expect(
      (await request(server()).get(messages).set(as(scope.owner)).expect(200)).body.data,
    ).toEqual([]);
  });

  it('keeps a workload measure, a default capacity, and per-person capacities', async () => {
    const scope = await setup();
    const portfolio = await create(scope, scope.owner);
    expect((portfolio as unknown as { workload: unknown }).workload).toEqual({
      measure: 'TASKS',
      defaultCapacity: null,
      capacities: [],
    });

    const set = await request(server())
      .patch(portfolios(scope, `/${portfolio.id}`))
      .set(as(scope.owner))
      .send({ workloadMeasure: 'HOURS', defaultCapacity: 30 })
      .expect(200);
    expect(set.body.data.workload).toMatchObject({ measure: 'HOURS', defaultCapacity: 30 });

    const capacity = (userId: string) => portfolios(scope, `/${portfolio.id}/capacity/${userId}`);
    const own = await request(server())
      .put(capacity(scope.member.userId))
      .set(as(scope.owner))
      .send({ capacity: 12 })
      .expect(200);
    expect(own.body.data.workload.capacities).toEqual([
      { userId: scope.member.userId, capacity: 12 },
    ]);

    // Not the member's to set, nor anyone's for a stranger.
    await request(server())
      .put(capacity(scope.member.userId))
      .set(as(scope.member))
      .send({ capacity: 99 })
      .expect(403);
    await request(server())
      .put(capacity(randomUUID()))
      .set(as(scope.owner))
      .send({ capacity: 5 })
      .expect(404);
    await request(server())
      .put(capacity(scope.member.userId))
      .set(as(scope.owner))
      .send({ capacity: -1 })
      .expect(422);

    const reset = await request(server())
      .put(capacity(scope.member.userId))
      .set(as(scope.owner))
      .send({ capacity: null })
      .expect(200);
    expect(reset.body.data.workload.capacities).toEqual([]);
  });

  it('refuses a colour that is not one', async () => {
    const scope = await setup();
    await request(server())
      .post(portfolios(scope))
      .set(as(scope.owner))
      .send({ name: 'Bad colour', color: 'teal' })
      .expect(422);
  });
});
