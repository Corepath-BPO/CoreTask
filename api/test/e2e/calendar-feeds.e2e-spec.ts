import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Calendar links: a secret iCalendar address for My Tasks or a project. */
describe('Calendar feeds (e2e)', () => {
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
  /** `YYYY-MM-DD`, this many days from today. */
  const inDays = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  /** The path of a feed's address: the test server answers on its own host. */
  const pathOf = (feedUrl: string) => new URL(feedUrl).pathname;

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

  it('publishes My Tasks and a project as iCalendar, behind a link that can be reset', async () => {
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
      .send({ name: 'Leasing' })
      .expect(201);
    const projectId = project.body.data.id as string;
    // The member is given work in Leasing, so is on that project (not on Secret).
    await context.prisma.projectMember.create({
      data: { projectId, userId: member.userId, workspaceId, role: 'EDITOR' },
    });
    const secret = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner.auth)
      .send({ name: 'Secret', visibility: 'PRIVATE' })
      .expect(201);

    const tasks = url(`/workspaces/${workspaceId}/tasks`);
    const task = async (body: Record<string, unknown>) =>
      (
        await request(server())
          .post(tasks)
          .set(owner.auth)
          .send({ projectId, ...body })
          .expect(201)
      ).body.data as { id: string };
    await task({
      title: 'Renew the lease, unit 12',
      assigneeId: member.userId,
      dueDate: inDays(5),
    });
    await task({ title: 'No date yet', assigneeId: member.userId });
    await task({ title: 'Long missed', assigneeId: member.userId, dueDate: inDays(-60) });
    await task({ title: 'Someone else’s', dueDate: inDays(3) });
    const walkthrough = new Date(`${inDays(2)}T15:00:00.000Z`);
    await task({
      title: 'Walkthrough',
      assigneeId: member.userId,
      dueDate: inDays(2),
      dueAt: walkthrough.toISOString(),
    });
    const done = await task({
      title: 'Already done',
      assigneeId: member.userId,
      dueDate: inDays(1),
    });
    await request(server())
      .patch(`${tasks}/${done.id}`)
      .set(owner.auth)
      .send({ status: 'DONE' })
      .expect(200);

    const feeds = url(`/workspaces/${workspaceId}/calendar-feeds`);
    expect((await request(server()).get(feeds).set(member.auth).expect(200)).body.data).toBeNull();
    const created = await request(server()).post(feeds).set(member.auth).send({}).expect(201);
    const feed = created.body.data as { id: string; url: string; projectId: string | null };
    expect(feed).toMatchObject({ projectId: null, lastFetchedAt: null });
    expect(feed.url).toMatch(/\/api\/v1\/calendar\/[\w-]{32}\.ics$/);
    // Asking again hands back the same link.
    const again = await request(server()).post(feeds).set(member.auth).send({}).expect(201);
    expect(again.body.data.url).toBe(feed.url);

    // No account: the link is the key.
    const ics = await request(server()).get(pathOf(feed.url)).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('X-WR-CALNAME:CoreTask · My Tasks');
    expect(ics.text).toContain('SUMMARY:Renew the lease\\, unit 12');
    expect(ics.text).toContain(`DTSTART;VALUE=DATE:${inDays(5).replace(/-/g, '')}`);
    expect(ics.text).toContain('SUMMARY:Walkthrough');
    expect(ics.text).toContain(
      `DTEND:${walkthrough.toISOString().replace(/[-:]/g, '').replace('.000', '')}`,
    );
    for (const absent of ['No date yet', 'Long missed', 'Someone else', 'Already done']) {
      expect(ics.text).not.toContain(absent);
    }
    const fetched = await request(server()).get(feeds).set(member.auth).expect(200);
    expect(fetched.body.data.lastFetchedAt).not.toBeNull();

    // A project's calendar has everyone's tasks in it.
    const projectFeed = await request(server())
      .post(feeds)
      .set(owner.auth)
      .send({ projectId })
      .expect(201);
    const projectIcs = await request(server())
      .get(pathOf(projectFeed.body.data.url as string))
      .expect(200);
    expect(projectIcs.text).toContain('X-WR-CALNAME:CoreTask · Leasing');
    expect(projectIcs.text).toContain('SUMMARY:Someone else’s');
    // A private project the caller cannot see has no calendar for them.
    await request(server())
      .post(feeds)
      .set(member.auth)
      .send({ projectId: secret.body.data.id as string })
      .expect(404);

    // A reset retires the old address.
    const reset = await request(server())
      .post(`${feeds}/reset`)
      .set(member.auth)
      .send({})
      .expect(200);
    expect(reset.body.data.url).not.toBe(feed.url);
    await request(server()).get(pathOf(feed.url)).expect(404);
    await request(server())
      .get(pathOf(reset.body.data.url as string))
      .expect(200);

    // Leaving the workspace takes the calendar with it.
    await context.prisma.workspaceMember.deleteMany({
      where: { workspaceId, userId: member.userId },
    });
    await request(server())
      .get(pathOf(reset.body.data.url as string))
      .expect(404);

    // Stopping a project's sync.
    await request(server()).delete(`${feeds}?projectId=${projectId}`).set(owner.auth).expect(204);
    await request(server())
      .get(pathOf(projectFeed.body.data.url as string))
      .expect(404);
    expect(
      (await request(server()).get(`${feeds}?projectId=${projectId}`).set(owner.auth).expect(200))
        .body.data,
    ).toBeNull();
  });
});
