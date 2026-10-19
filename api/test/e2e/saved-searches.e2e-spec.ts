import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Advanced search over tasks, and the searches people keep. */
describe('Advanced search (e2e)', () => {
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

  const setUp = async () => {
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
    const project = async (name: string, visibility = 'PUBLIC') =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/projects`))
          .set(owner.auth)
          .send({ name, visibility })
          .expect(201)
      ).body.data.id as string;
    const maintenance = await project('Maintenance');
    const leasing = await project('Leasing');
    const board = await project('Board only', 'PRIVATE');

    const task = async (
      who: { auth: Record<string, string> },
      body: Record<string, unknown>,
    ): Promise<string> =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/tasks`))
          .set(who.auth)
          .send(body)
          .expect(201)
      ).body.data.id as string;

    const leak = await task(owner, {
      title: 'Leak under the sink',
      projectId: maintenance,
      assigneeId: member.userId,
      dueDate: '2026-10-13T00:00:00.000Z',
    });
    const boiler = await task(member, {
      title: 'Annual service',
      description: 'Check the boiler pressure',
      projectId: maintenance,
    });
    const renewal = await task(member, {
      title: 'Renew lease for 4B',
      projectId: leasing,
      dueDate: '2026-10-14T00:00:00.000Z',
    });
    const done = await task(owner, { title: 'Replace the bulb', projectId: maintenance });
    await context.prisma.task.update({ where: { id: done }, data: { completedAt: new Date() } });
    const secret = await task(owner, { title: 'Board pay review', projectId: board });

    return {
      owner,
      member,
      workspaceId,
      maintenance,
      leasing,
      leak,
      boiler,
      renewal,
      done,
      secret,
    };
  };

  it('finds tasks by every filter, only among those the searcher can see', async () => {
    const s = await setUp();
    const search = async (filters: Record<string, unknown>, who = s.member) => {
      const response = await request(server())
        .post(url(`/workspaces/${s.workspaceId}/search/tasks`))
        .set(who.auth)
        .send({ filters, today: '2026-10-14' })
        .expect(200);
      return response.body.data as { total: number; items: { id: string; title: string }[] };
    };
    const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id).sort();

    // Incomplete by default, and never the private project's work.
    const all = await search({});
    expect(ids(all)).toEqual([s.leak, s.boiler, s.renewal].sort());
    expect(all.total).toBe(3);
    expect(ids(await search({}, s.owner))).toContain(s.secret);

    expect(ids(await search({ text: 'BOILER' }))).toEqual([s.boiler]);
    expect(ids(await search({ assigneeIds: ['me'] }))).toEqual([s.leak]);
    expect(ids(await search({ assigneeIds: ['none'] }))).toEqual([s.boiler, s.renewal].sort());
    expect(ids(await search({ projectIds: [s.leasing] }))).toEqual([s.renewal]);
    expect(ids(await search({ due: 'OVERDUE' }))).toEqual([s.leak]);
    expect(ids(await search({ due: 'TODAY' }))).toEqual([s.renewal]);
    expect(ids(await search({ due: 'NO_DATE' }))).toEqual([s.boiler]);
    expect(ids(await search({ completion: 'COMPLETED' }))).toEqual([s.done]);
    expect((await search({ completion: 'ANY' })).total).toBe(4);
    expect(ids(await search({ createdByIds: ['me'] }))).toEqual([s.boiler, s.renewal].sort());
    expect(ids(await search({ createdByIds: [s.owner.userId], due: 'OVERDUE' }))).toEqual([s.leak]);

    // Due date first, undated last; or by title.
    expect((await search({ sort: 'DUE_DATE' })).items.map((item) => item.title)).toEqual([
      'Leak under the sink',
      'Renew lease for 4B',
      'Annual service',
    ]);
    expect((await search({ sort: 'TITLE' })).items[0]?.title).toBe('Annual service');

    // Nonsense in the filters is ignored rather than refused.
    expect((await search({ due: 'SOMEDAY', assigneeIds: ['robert'] })).total).toBe(3);
  });

  it('keeps each person’s saved searches to themselves', async () => {
    const s = await setUp();
    const base = url(`/workspaces/${s.workspaceId}/saved-searches`);

    const saved = await request(server())
      .post(base)
      .set(s.member.auth)
      .send({
        name: '  Mine, overdue ',
        filters: { assigneeIds: ['me'], due: 'OVERDUE', bogus: 1 },
      })
      .expect(201);
    expect(saved.body.data).toMatchObject({
      name: 'Mine, overdue',
      filters: { assigneeIds: ['me'], due: 'OVERDUE' },
    });
    const id = saved.body.data.id as string;
    await request(server())
      .post(base)
      .set(s.member.auth)
      .send({ name: '', filters: {} })
      .expect(422);

    expect((await request(server()).get(base).set(s.owner.auth).expect(200)).body.data).toEqual([]);
    await request(server())
      .patch(`${base}/${id}`)
      .set(s.owner.auth)
      .send({ name: 'x' })
      .expect(404);

    const renamed = await request(server())
      .patch(`${base}/${id}`)
      .set(s.member.auth)
      .send({ name: 'Overdue for me', filters: { assigneeIds: ['me'] } })
      .expect(200);
    expect(renamed.body.data).toMatchObject({
      name: 'Overdue for me',
      filters: { assigneeIds: ['me'] },
    });

    await request(server()).delete(`${base}/${id}`).set(s.member.auth).expect(204);
    expect((await request(server()).get(base).set(s.member.auth).expect(200)).body.data).toEqual(
      [],
    );
  });
});
