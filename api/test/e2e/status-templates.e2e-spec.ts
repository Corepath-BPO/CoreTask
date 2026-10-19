import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Status templates: read by anyone who can see the project, changed by its editors. */
describe('Status templates (e2e)', () => {
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
    return { Authorization: `Bearer ${response.body.data.accessToken as string}` };
  };

  const setup = async () => {
    const owner = await register('Ada Owner');
    const guestAuth = await register('Cy Guest');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    const guest = await request(server()).get(url('/auth/me')).set(guestAuth).expect(200);
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: guest.body.data.id as string, role: WorkspaceRole.GUEST },
    });
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner)
      .send({ name: 'Leasing' })
      .expect(201);
    const templates = url(
      `/workspaces/${workspaceId}/projects/${project.body.data.id as string}/status-templates`,
    );
    return { owner, guestAuth, templates };
  };

  it('saves, lists by name, changes and deletes a template', async () => {
    const { owner, templates } = await setup();

    const weekly = await request(server())
      .post(templates)
      .set(owner)
      .send({
        name: 'Weekly update',
        status: 'ON_TRACK',
        summary: '  Shipped this week:\n- ',
        nextSteps: '   ',
      })
      .expect(201);
    expect(weekly.body.data).toMatchObject({
      name: 'Weekly update',
      status: 'ON_TRACK',
      summary: 'Shipped this week:\n-',
      // Blank text is stored as none, so the composer's section stays empty.
      nextSteps: null,
    });

    await request(server()).post(templates).set(owner).send({ name: 'Blocker report' }).expect(201);

    const listed = await request(server()).get(templates).set(owner).expect(200);
    expect(listed.body.data.map((row: { name: string }) => row.name)).toEqual([
      'Blocker report',
      'Weekly update',
    ]);

    const id = weekly.body.data.id as string;
    const changed = await request(server())
      .patch(`${templates}/${id}`)
      .set(owner)
      .send({ status: null, nextSteps: 'Plan next sprint' })
      .expect(200);
    expect(changed.body.data).toMatchObject({ status: null, nextSteps: 'Plan next sprint' });

    await request(server()).delete(`${templates}/${id}`).set(owner).expect(204);
    await request(server()).patch(`${templates}/${id}`).set(owner).send({}).expect(404);
  });

  it('lets a guest read the templates but not change them, and refuses a bad status', async () => {
    const { owner, guestAuth, templates } = await setup();
    await request(server()).post(templates).set(owner).send({ name: 'Weekly' }).expect(201);

    const read = await request(server()).get(templates).set(guestAuth).expect(200);
    expect(read.body.data).toHaveLength(1);
    await request(server()).post(templates).set(guestAuth).send({ name: 'Mine' }).expect(403);

    await request(server())
      .post(templates)
      .set(owner)
      .send({ name: 'Odd', status: 'SIDEWAYS' })
      .expect(422);
  });
});
