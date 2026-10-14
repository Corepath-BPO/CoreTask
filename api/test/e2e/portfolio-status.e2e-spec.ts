import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** A portfolio's own status updates: set by its owner or a manager, read by all. */
describe('Portfolio status updates (e2e)', () => {
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

  const register = async (name: string) => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    return {
      auth: { Authorization: `Bearer ${response.body.data.accessToken as string}` },
      userId: response.body.data.user.id as string,
    };
  };

  it('keeps a history whose newest entry is the portfolio’s status', async () => {
    const owner = await register('Ada Owner');
    const member = await register('Bea Member');
    const guest = await register('Gus Guest');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
        { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
      ],
    });
    const portfolios = url(`/workspaces/${workspaceId}/portfolios`);
    const portfolio = await request(server())
      .post(portfolios)
      .set(member.auth)
      .send({ name: 'Leasing programme', color: '#6366F1' })
      .expect(201);
    const portfolioId = portfolio.body.data.id as string;
    expect(portfolio.body.data.status).toBeNull();
    // The workspace owner stars it, so hears about its status.
    await request(server())
      .put(`${portfolios}/${portfolioId}/star`)
      .set(owner.auth)
      .send({ starred: true })
      .expect(200);

    const updates = `${portfolios}/${portfolioId}/status-updates`;
    const first = await request(server())
      .post(updates)
      .set(member.auth)
      .send({ status: 'AT_RISK', title: 'Week 41', summary: ' Two buildings behind. ' })
      .expect(201);
    expect(first.body.data).toMatchObject({
      status: 'AT_RISK',
      title: 'Week 41',
      summary: 'Two buildings behind.',
      nextSteps: null,
      author: expect.objectContaining({ name: 'Bea Member' }),
    });
    await request(server())
      .post(updates)
      .set(owner.auth)
      .send({ status: 'ON_TRACK', title: 'Week 42' })
      .expect(201);

    // Only the owner (Bea made it) or a manager; a guest reads.
    const other = await register('Cy Other');
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: other.userId, role: WorkspaceRole.MEMBER },
    });
    await request(server())
      .post(updates)
      .set(other.auth)
      .send({ status: 'OFF_TRACK', title: 'Mine' })
      .expect(403);
    await request(server())
      .post(updates)
      .set(member.auth)
      .send({ status: 'SOMEDAY', title: 'Bad' })
      .expect(422);

    const list = await request(server()).get(updates).set(guest.auth).expect(200);
    expect(list.body.data.map((update: { title: string }) => update.title)).toEqual([
      'Week 42',
      'Week 41',
    ]);
    const read = await request(server()).get(portfolios).set(guest.auth).expect(200);
    expect(read.body.data[0].status).toMatchObject({ value: 'ON_TRACK' });

    const notices = await context.prisma.notification.findMany({
      where: { userId: owner.userId },
    });
    expect(notices.map((notice) => notice.title)).toContain(
      'Bea Member set Leasing programme to At risk',
    );

    // Deleting is its author's or a manager's.
    await request(server())
      .delete(`${updates}/${first.body.data.id as string}`)
      .set(other.auth)
      .expect(403);
    await request(server())
      .delete(`${updates}/${first.body.data.id as string}`)
      .set(member.auth)
      .expect(204);
    expect(
      (await request(server()).get(updates).set(member.auth).expect(200)).body.data,
    ).toHaveLength(1);
  });
  it('asks the owner of a project or a portfolio for an update, once an hour', async () => {
    const owner = await register('Ada Owner');
    const member = await register('Bea Member');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner.auth)
      .send({ name: 'Leasing', leadId: owner.userId })
      .expect(201);
    const projectAsk = url(
      `/workspaces/${workspaceId}/projects/${project.body.data.id as string}/status-updates/request`,
    );

    const asked = await request(server()).post(projectAsk).set(member.auth).expect(200);
    expect(asked.body.data.recipient).toEqual({ id: owner.userId, name: 'Ada Owner' });
    // Pressed again within the hour: answered the same, but nobody is told twice.
    await request(server()).post(projectAsk).set(member.auth).expect(200);
    // The owner has no one to ask but themselves.
    await request(server()).post(projectAsk).set(owner.auth).expect(400);

    const portfolio = await request(server())
      .post(url(`/workspaces/${workspaceId}/portfolios`))
      .set(owner.auth)
      .send({ name: 'Programme', color: '#6366F1' })
      .expect(201);
    await request(server())
      .post(
        url(
          `/workspaces/${workspaceId}/portfolios/${portfolio.body.data.id as string}/status-updates/request`,
        ),
      )
      .set(member.auth)
      .expect(200);

    const notices = await context.prisma.notification.findMany({
      where: { userId: owner.userId },
      orderBy: { createdAt: 'asc' },
    });
    const asks = notices.map((notice) => notice.title).filter((title) => title.includes('asked'));
    expect(asks).toEqual([
      'Bea Member asked for a status update on Leasing',
      'Bea Member asked for a status update on Programme',
    ]);
  });
});
