import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Time tracking: entries against a task, their total, and who may change them. */
describe('Time tracking (e2e)', () => {
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

  it('logs time, totals it beside the estimate, and lets only the author or a manager change it', async () => {
    const owner = await register('Ada Owner');
    const member = await register('Bea Member');
    const other = await register('Cy Other');
    const guest = await register('Dee Guest');
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
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner.auth)
      .send({ name: 'Leasing' })
      .expect(201);
    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(owner.auth)
      .send({ title: 'Inspect unit', projectId: project.body.data.id, estimatedMinutes: 120 })
      .expect(201);
    const entries = url(
      `/workspaces/${workspaceId}/tasks/${task.body.data.id as string}/time-entries`,
    );

    await request(server())
      .post(entries)
      .set(owner.auth)
      .send({ minutes: 45, date: '2026-10-12', note: 'Walkthrough' })
      .expect(201);
    const logged = await request(server())
      .post(entries)
      .set(member.auth)
      .send({ minutes: 30 })
      .expect(201);
    expect(logged.body.data).toMatchObject({ totalMinutes: 75, estimatedMinutes: 120 });
    expect(logged.body.data.entries).toHaveLength(2);

    // A guest reads it, but logs nothing; nothing at all is not a duration.
    const read = await request(server()).get(entries).set(guest.auth).expect(200);
    expect(read.body.data.totalMinutes).toBe(75);
    await request(server()).post(entries).set(guest.auth).send({ minutes: 10 }).expect(403);
    await request(server()).post(entries).set(owner.auth).send({ minutes: 0 }).expect(422);

    const memberEntry = (logged.body.data.entries as { id: string; user: { id: string } }[]).find(
      (entry) => entry.user.id === member.userId,
    );
    await request(server())
      .patch(`${entries}/${memberEntry?.id}`)
      .set(other.auth)
      .send({ minutes: 600 })
      .expect(403);
    const edited = await request(server())
      .patch(`${entries}/${memberEntry?.id}`)
      .set(member.auth)
      .send({ minutes: 40 })
      .expect(200);
    expect(edited.body.data.totalMinutes).toBe(85);

    // The owner manages the workspace, so may remove anyone's entry.
    const removed = await request(server())
      .delete(`${entries}/${memberEntry?.id}`)
      .set(owner.auth)
      .expect(200);
    expect(removed.body.data).toMatchObject({ totalMinutes: 45 });
    expect(removed.body.data.entries[0]).toMatchObject({ date: '2026-10-12', note: 'Walkthrough' });
  });
});
