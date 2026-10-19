import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** The project Overview's key resources, and its milestones by kind. */
describe('Project overview (e2e)', () => {
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

  it('keeps web links for the project, and lists its milestones', async () => {
    const owner = await register('Ada Owner');
    const guest = await register('Gus Guest');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
    });
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner.auth)
      .send({ name: 'Launch' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const resources = url(`/workspaces/${workspaceId}/projects/${projectId}/resources`);

    const added = await request(server())
      .post(resources)
      .set(owner.auth)
      .send({ title: 'Brief', url: 'docs.example.org/brief' })
      .expect(201);
    expect(added.body.data).toEqual([
      expect.objectContaining({ title: 'Brief', url: 'https://docs.example.org/brief' }),
    ]);
    const untitled = await request(server())
      .post(resources)
      .set(owner.auth)
      .send({ title: '', url: 'https://drive.example.org/folder' })
      .expect(201);
    expect(untitled.body.data[1].title).toBe('drive.example.org');
    await request(server())
      .post(resources)
      .set(owner.auth)
      .send({ title: 'Trap', url: 'javascript:alert(1)' })
      .expect(400);
    await request(server())
      .post(resources)
      .set(guest.auth)
      .send({ title: 'Mine', url: 'https://x.example.org' })
      .expect(403);
    expect(
      (await request(server()).get(resources).set(guest.auth).expect(200)).body.data,
    ).toHaveLength(2);

    const left = await request(server())
      .delete(`${resources}/${added.body.data[0].id as string}`)
      .set(owner.auth)
      .expect(200);
    expect(left.body.data.map((row: { title: string }) => row.title)).toEqual([
      'drive.example.org',
    ]);

    // Milestones, by kind.
    const tasks = url(`/workspaces/${workspaceId}/tasks`);
    await request(server())
      .post(tasks)
      .set(owner.auth)
      .send({ title: 'Ordinary', projectId })
      .expect(201);
    await request(server())
      .post(tasks)
      .set(owner.auth)
      .send({ title: 'Beta ships', projectId, kind: 'MILESTONE' })
      .expect(201);
    const milestones = await request(server())
      .get(tasks)
      .set(owner.auth)
      .query({ projectId, kind: 'MILESTONE' })
      .expect(200);
    expect(milestones.body.data.map((task: { title: string }) => task.title)).toEqual([
      'Beta ships',
    ]);
  });
});
