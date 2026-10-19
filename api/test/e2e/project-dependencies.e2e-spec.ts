import { API_PREFIX } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** A project's dependencies, for its Timeline: both ends inside the project. */
describe('Project dependencies (e2e)', () => {
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

  it('lists the edges between two of its tasks, and only those', async () => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Ada Owner', email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    const auth = { Authorization: `Bearer ${response.body.data.accessToken as string}` };
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    const project = async (name: string) =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/projects`))
          .set(auth)
          .send({ name })
          .expect(201)
      ).body.data.id as string;
    const launch = await project('Launch');
    const other = await project('Other');
    const task = async (title: string, projectId: string) =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/tasks`))
          .set(auth)
          .send({ title, projectId })
          .expect(201)
      ).body.data.id as string;
    const design = await task('Design', launch);
    const build = await task('Build', launch);
    const elsewhere = await task('Elsewhere', other);
    const wait = (blocked: string, blocking: string) =>
      request(server())
        .post(url(`/workspaces/${workspaceId}/tasks/${blocked}/dependencies`))
        .set(auth)
        .send({ taskId: blocking, direction: 'BLOCKED_BY' })
        .expect(201);
    await wait(build, design);
    await wait(build, elsewhere);

    const edges = await request(server())
      .get(url(`/workspaces/${workspaceId}/projects/${launch}/dependencies`))
      .set(auth)
      .expect(200);
    expect(edges.body.data).toEqual([
      { id: expect.any(String), blockingId: design, blockedId: build },
    ]);
  });
});
