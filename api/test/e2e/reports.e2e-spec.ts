import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Report dashboards: shared questions, answered per reader over what they can see. */
describe('Reports (e2e)', () => {
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

  const setup = async () => {
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

    const project = async (name: string, visibility?: 'PRIVATE') =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/projects`))
          .set(owner.auth)
          .send({ name, ...(visibility ? { visibility } : {}) })
          .expect(201)
      ).body.data.id as string;
    const leasing = await project('Leasing');
    const board = await project('Board pack', 'PRIVATE');

    const task = (projectId: string, title: string, extra: Record<string, unknown> = {}) =>
      context.prisma.task.create({
        data: { workspaceId, projectId, title, createdById: owner.userId, ...extra },
      });
    const yesterday = new Date(Date.now() - 86_400_000);
    await task(leasing, 'Renew lease', { assigneeId: member.userId });
    await task(leasing, 'Chase deposit', { assigneeId: member.userId, dueDate: yesterday });
    await task(leasing, 'File contract', { completedAt: new Date() });
    await task(board, 'Draft minutes', { assigneeId: owner.userId });

    return { owner, member, workspaceId, leasing, board };
  };

  it('counts what each reader can see, grouped as asked', async () => {
    const scope = await setup();
    const tasks = url(`/workspaces/${scope.workspaceId}/reports/tasks`);

    const all = await request(server())
      .get(tasks)
      .query({ groupBy: 'NONE' })
      .set(scope.owner.auth)
      .expect(200);
    expect(all.body.data).toEqual({ total: 4, groups: [] });

    // The member is not in the private project, so its task is not theirs to count.
    const theirs = await request(server())
      .get(tasks)
      .query({ groupBy: 'ASSIGNEE', completion: 'OPEN' })
      .set(scope.member.auth)
      .expect(200);
    expect(theirs.body.data.total).toBe(2);
    expect(theirs.body.data.groups).toEqual([
      expect.objectContaining({ key: scope.member.userId, label: 'Bea Member', count: 2 }),
    ]);

    const byProject = await request(server())
      .get(tasks)
      .query({ groupBy: 'PROJECT' })
      .set(scope.owner.auth)
      .expect(200);
    expect(
      byProject.body.data.groups.map((group: { label: string; count: number }) => [
        group.label,
        group.count,
      ]),
    ).toEqual([
      ['Leasing', 3],
      ['Board pack', 1],
    ]);

    const overdue = await request(server())
      .get(tasks)
      .query({ groupBy: 'NONE', overdueOnly: 'true', projectIds: scope.leasing })
      .set(scope.owner.auth)
      .expect(200);
    expect(overdue.body.data.total).toBe(1);

    const weeks = await request(server())
      .get(tasks)
      .query({ groupBy: 'COMPLETED_WEEK' })
      .set(scope.owner.auth)
      .expect(200);
    expect(weeks.body.data.groups).toHaveLength(12);
    expect(weeks.body.data.groups.at(-1).count).toBe(1);

    await request(server())
      .get(tasks)
      .query({ groupBy: 'COLOUR' })
      .set(scope.owner.auth)
      .expect(422);
  });

  it('keeps dashboards for the workspace, changed only by their owner or a manager', async () => {
    const scope = await setup();
    const dashboards = url(`/workspaces/${scope.workspaceId}/report-dashboards`);

    const made = await request(server())
      .post(dashboards)
      .set(scope.member.auth)
      .send({
        name: 'Leasing ops',
        charts: [
          {
            id: 'c-1',
            title: 'Open by assignee',
            kind: 'BAR',
            groupBy: 'ASSIGNEE',
            completion: 'OPEN',
            projectIds: [],
            overdueOnly: false,
          },
        ],
      })
      .expect(201);
    expect(made.body.data).toMatchObject({
      name: 'Leasing ops',
      owner: expect.objectContaining({ name: 'Bea Member' }),
      charts: [expect.objectContaining({ id: 'c-1', kind: 'BAR', groupBy: 'ASSIGNEE' })],
    });
    const id = made.body.data.id as string;

    // A number with groups is not a chart anyone can draw; it is dropped, not stored.
    const odd = await request(server())
      .patch(`${dashboards}/${id}`)
      .set(scope.member.auth)
      .send({
        charts: [
          {
            id: 'c-2',
            title: 'Odd',
            kind: 'NUMBER',
            groupBy: 'STATUS',
            completion: 'ALL',
            projectIds: [],
            overdueOnly: false,
          },
        ],
      })
      .expect(200);
    expect(odd.body.data.charts).toEqual([]);

    const listed = await request(server()).get(dashboards).set(scope.owner.auth).expect(200);
    expect(listed.body.data).toHaveLength(1);

    // The owner of the workspace is a manager; the dashboard is still the member's.
    const third = await register('Cy Third');
    await context.prisma.workspaceMember.create({
      data: { workspaceId: scope.workspaceId, userId: third.userId, role: WorkspaceRole.MEMBER },
    });
    await request(server())
      .patch(`${dashboards}/${id}`)
      .set(third.auth)
      .send({ name: 'Mine now' })
      .expect(403);
    await request(server()).delete(`${dashboards}/${id}`).set(scope.owner.auth).expect(204);
  });
});
