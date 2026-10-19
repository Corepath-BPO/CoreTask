import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** A team's page: its projects as the reader may see them, and its messages. */
describe('Team page (e2e)', () => {
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

  it('shows the projects each reader may open, and lets the team talk', async () => {
    const owner = await register('Ada Owner');
    const member = await register('Bea Member');
    const outsider = await register('Cy Outsider');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
        { workspaceId, userId: outsider.userId, role: WorkspaceRole.MEMBER },
      ],
    });
    const teams = url(`/workspaces/${workspaceId}/teams`);
    const team = await request(server())
      .post(teams)
      .set(owner.auth)
      .send({ name: 'Maintenance crew' })
      .expect(201);
    const teamId = team.body.data.id as string;
    await request(server())
      .post(`${teams}/${teamId}/members`)
      .set(owner.auth)
      .send({ userId: member.userId })
      .expect(200);

    const project = async (name: string, visibility: string) =>
      request(server())
        .post(url(`/workspaces/${workspaceId}/projects`))
        .set(owner.auth)
        .send({ name, visibility, teamId })
        .expect(201);
    await project('Repairs', 'PUBLIC');
    await project('Budget', 'PRIVATE');

    // The owner is on both; another member only sees the open one.
    const asOwner = await request(server()).get(`${teams}/${teamId}`).set(owner.auth).expect(200);
    expect(asOwner.body.data.projects.map((p: { name: string }) => p.name)).toEqual([
      'Budget',
      'Repairs',
    ]);
    const asMember = await request(server()).get(`${teams}/${teamId}`).set(member.auth).expect(200);
    expect(asMember.body.data.projects.map((p: { name: string }) => p.name)).toEqual(['Repairs']);
    expect(asMember.body.data.members.map((m: { id: string }) => m.id)).toContain(member.userId);

    // Members of the team post; someone outside it reads but does not.
    const messages = `${teams}/${teamId}/messages`;
    const posted = await request(server())
      .post(messages)
      .set(member.auth)
      .send({ title: 'Ladder inspection', body: 'Due Friday.' })
      .expect(201);
    expect(posted.body.data).toMatchObject({ teamId, title: 'Ladder inspection' });
    await request(server())
      .post(messages)
      .set(outsider.auth)
      .send({ title: 'Hello', body: 'Hi' })
      .expect(403);
    const read = await request(server()).get(messages).set(outsider.auth).expect(200);
    expect(read.body.data).toHaveLength(1);

    // A manager may reply though not on the team; the author hears of it.
    const replied = await request(server())
      .post(`${messages}/${posted.body.data.id as string}/replies`)
      .set(owner.auth)
      .send({ body: 'Booked.' })
      .expect(201);
    expect(replied.body.data.replies).toHaveLength(1);
    const notices = await context.prisma.notification.findMany({
      where: { userId: member.userId },
    });
    expect(notices.some((notice) => notice.title.includes('replied to “Ladder inspection”'))).toBe(
      true,
    );

    // Deleted by its author or a manager only.
    await request(server())
      .delete(`${messages}/${posted.body.data.id as string}`)
      .set(outsider.auth)
      .expect(403);
    await request(server())
      .delete(`${messages}/${posted.body.data.id as string}`)
      .set(member.auth)
      .expect(204);
  });
});
