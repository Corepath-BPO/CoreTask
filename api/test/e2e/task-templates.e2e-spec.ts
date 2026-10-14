import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Task templates: saved per project, used to make a task with its subtasks. */
describe('Task templates (e2e)', () => {
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
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const setup = async () => {
    const owner = await register('Ada Owner');
    const guest = await register('Cy Guest');
    const auth = { Authorization: `Bearer ${owner.token}` };
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
    });
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(auth)
      .send({ name: 'Leasing' })
      .expect(201);
    return {
      owner,
      guest,
      auth,
      workspaceId,
      projectId: project.body.data.id as string,
      firstSectionId: project.body.data.sections[0].id as string,
    };
  };

  type Scope = Awaited<ReturnType<typeof setup>>;
  const templates = (scope: Scope, path = '') =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/task-templates${path}`);

  it('saves a template and makes a task from it, subtasks and all', async () => {
    const scope = await setup();
    const saved = await request(server())
      .post(templates(scope))
      .set(scope.auth)
      .send({
        name: 'Lease renewal',
        title: 'Renew the lease',
        description: 'Check the rent first.',
        kind: 'APPROVAL',
        assigneeId: scope.owner.userId,
        dueInDays: 7,
        subtasks: [{ title: 'Draft the notice' }, { title: 'Send it' }],
      })
      .expect(201);
    expect(saved.body.data.subtasks).toEqual([
      { title: 'Draft the notice', assigneeId: null },
      { title: 'Send it', assigneeId: null },
    ]);

    const used = await request(server())
      .post(templates(scope, `/${saved.body.data.id as string}/use`))
      .set(scope.auth)
      .send({})
      .expect(201);
    expect(used.body.data).toMatchObject({
      title: 'Renew the lease',
      kind: 'APPROVAL',
      approvalStatus: 'PENDING',
      assigneeId: scope.owner.userId,
      sectionId: scope.firstSectionId,
    });
    expect(used.body.data.dueDate).not.toBeNull();

    const subtasks = await context.prisma.task.findMany({
      where: { parentTaskId: used.body.data.id as string },
      orderBy: { position: 'asc' },
      select: { title: true },
    });
    expect(subtasks.map((row) => row.title)).toEqual(['Draft the notice', 'Send it']);
  });

  it('lists templates for readers, and keeps writing to editors', async () => {
    const scope = await setup();
    await request(server())
      .post(templates(scope))
      .set(scope.auth)
      .send({ name: 'Inspection', title: 'Inspect the unit' })
      .expect(201);

    const guestAuth = { Authorization: `Bearer ${scope.guest.token}` };
    const listed = await request(server()).get(templates(scope)).set(guestAuth).expect(200);
    expect(listed.body.data.map((row: { name: string }) => row.name)).toEqual(['Inspection']);

    await request(server())
      .post(templates(scope))
      .set(guestAuth)
      .send({ name: 'Nope', title: 'Nope' })
      .expect(403);
  });

  it('edits and deletes a template, leaving tasks made from it alone', async () => {
    const scope = await setup();
    const saved = await request(server())
      .post(templates(scope))
      .set(scope.auth)
      .send({ name: 'Inspection', title: 'Inspect the unit' })
      .expect(201);
    const id = saved.body.data.id as string;

    const renamed = await request(server())
      .patch(templates(scope, `/${id}`))
      .set(scope.auth)
      .send({ name: 'Move-out inspection', dueInDays: null })
      .expect(200);
    expect(renamed.body.data.name).toBe('Move-out inspection');

    await request(server())
      .post(templates(scope, `/${id}/use`))
      .set(scope.auth)
      .send({})
      .expect(201);
    await request(server())
      .delete(templates(scope, `/${id}`))
      .set(scope.auth)
      .expect(204);

    expect(await context.prisma.task.count({ where: { title: 'Inspect the unit' } })).toBe(1);
  });
});
