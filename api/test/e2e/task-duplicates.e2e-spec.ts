import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** "Mark as duplicate": completed, linked to the original, collaborators carried over. */
describe('Task duplicates (e2e)', () => {
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

  it('closes the duplicate, points it at the original, and can be undone', async () => {
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
    const task = async (title: string, who = owner, extra: Record<string, unknown> = {}) =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/tasks`))
          .set(who.auth)
          .send({ title, ...extra })
          .expect(201)
      ).body.data.id as string;
    const original = await task('Leak under the sink');
    const repeat = await task('Kitchen sink leaking', member);
    const duplicateOf = (taskId: string) =>
      url(`/workspaces/${workspaceId}/tasks/${taskId}/duplicate-of`);

    await request(server())
      .post(duplicateOf(repeat))
      .set(member.auth)
      .send({ taskId: repeat })
      .expect(400);

    const marked = await request(server())
      .post(duplicateOf(repeat))
      .set(member.auth)
      .send({ taskId: original })
      .expect(200);
    expect(marked.body.data).toMatchObject({
      duplicateOf: { id: original, title: 'Leak under the sink' },
      status: 'DONE',
    });
    expect(marked.body.data.completedAt).not.toBeNull();

    // Whoever followed the duplicate now follows the original.
    const followers = await context.prisma.follower.findMany({ where: { taskId: original } });
    expect(followers.map((row) => row.userId)).toContain(member.userId);

    // The original cannot then be marked a duplicate of its own duplicate.
    await request(server())
      .post(duplicateOf(original))
      .set(owner.auth)
      .send({ taskId: repeat })
      .expect(400);

    const cleared = await request(server())
      .delete(duplicateOf(repeat))
      .set(member.auth)
      .expect(200);
    expect(cleared.body.data.duplicateOf).toBeNull();
  });
});
