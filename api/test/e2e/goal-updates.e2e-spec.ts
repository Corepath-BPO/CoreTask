import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Goal status updates: a history whose newest entry sets the goal's status. */
describe('Goal updates (e2e)', () => {
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

  it('keeps a history of check-ins and sets the status from the newest', async () => {
    const owner = await register('Ada Owner');
    const member = await register('Bea Member');
    const other = await register('Cy Other');
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
        { workspaceId, userId: other.userId, role: WorkspaceRole.MEMBER },
        { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
      ],
    });
    const goal = await request(server())
      .post(url(`/workspaces/${workspaceId}/goals`))
      .set(owner.auth)
      .send({ name: 'Fill every vacancy', ownerId: owner.userId })
      .expect(201);
    const goalId = goal.body.data.id as string;
    await request(server())
      .patch(url(`/workspaces/${workspaceId}/goals/${goalId}`))
      .set(owner.auth)
      .send({ progress: 40 })
      .expect(200);
    const updates = url(`/workspaces/${workspaceId}/goals/${goalId}/updates`);

    const first = await request(server())
      .post(updates)
      .set(member.auth)
      .send({ status: 'AT_RISK', body: 'Two units still empty.' })
      .expect(201);
    expect(first.body.data).toMatchObject({ status: 'AT_RISK', progress: 40 });
    expect(first.body.data.body).toContain('Two units still empty.');
    await request(server()).post(updates).set(member.auth).send({ status: 'ON_TRACK' }).expect(201);
    await request(server()).post(updates).set(guest.auth).send({ status: 'MISSED' }).expect(403);
    await request(server()).post(updates).set(member.auth).send({ status: 'SOMEDAY' }).expect(422);

    const list = await request(server()).get(updates).set(guest.auth).expect(200);
    expect(list.body.data.map((update: { status: string }) => update.status)).toEqual([
      'ON_TRACK',
      'AT_RISK',
    ]);
    const after = await context.prisma.goal.findUniqueOrThrow({ where: { id: goalId } });
    expect(after.status).toBe('ON_TRACK');

    const notices = await context.prisma.notification.findMany({ where: { userId: owner.userId } });
    expect(notices.some((notice) => notice.title.includes('updated “Fill every vacancy”'))).toBe(
      true,
    );

    await request(server())
      .delete(`${updates}/${first.body.data.id as string}`)
      .set(other.auth)
      .expect(403);
    await request(server())
      .delete(`${updates}/${first.body.data.id as string}`)
      .set(member.auth)
      .expect(204);
  });

  it('measures a goal by a number between its start and its target', async () => {
    const owner = await register('Ada Owner');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    const created = await request(server())
      .post(url(`/workspaces/${workspaceId}/goals`))
      .set(owner.auth)
      .send({
        name: 'Sign 40 leases',
        progressSource: 'METRIC',
        metricStart: 0,
        metricCurrent: 10,
        metricTarget: 40,
        metricUnit: ' leases ',
      })
      .expect(201);
    expect(created.body.data).toMatchObject({
      progressSource: 'METRIC',
      progress: 25,
      metric: { start: 0, current: 10, target: 40, unit: 'leases' },
    });

    const moved = await request(server())
      .patch(url(`/workspaces/${workspaceId}/goals/${created.body.data.id as string}`))
      .set(owner.auth)
      .send({ metricCurrent: 30 })
      .expect(200);
    expect(moved.body.data.progress).toBe(75);

    // Without all three figures there is nothing to measure.
    const half = await request(server())
      .post(url(`/workspaces/${workspaceId}/goals`))
      .set(owner.auth)
      .send({ name: 'Unfinished', progressSource: 'METRIC', metricTarget: 10 })
      .expect(201);
    expect(half.body.data).toMatchObject({ progress: 0, metric: null });
  });
});
