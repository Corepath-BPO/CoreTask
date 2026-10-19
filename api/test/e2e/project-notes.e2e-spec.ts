import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** A project's Note: read by whoever can open the project, written by its editors. */
describe('Project note (e2e)', () => {
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

  it('keeps one sanitised document per project, for the right people', async () => {
    const owner = await register('Ada Owner');
    const guest = await register('Gus Guest');
    const member = await register('Bea Member');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
        { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
      ],
    });
    const project = async (visibility: string) =>
      (
        await request(server())
          .post(url(`/workspaces/${workspaceId}/projects`))
          .set(owner.auth)
          .send({ name: `Plan ${visibility}`, visibility })
          .expect(201)
      ).body.data.id as string;
    const open = await project('PUBLIC');
    const secret = await project('PRIVATE');
    const note = (projectId: string) =>
      url(`/workspaces/${workspaceId}/projects/${projectId}/note`);

    const empty = await request(server()).get(note(open)).set(member.auth).expect(200);
    expect(empty.body.data).toEqual({ body: '', updatedBy: null, updatedAt: null });

    const saved = await request(server())
      .put(note(open))
      .set(member.auth)
      .send({ body: '<h2>Goals</h2><p>Ship it</p><script>alert(1)</script>' })
      .expect(200);
    expect(saved.body.data.body).toContain('<h2>Goals</h2>');
    expect(saved.body.data.body).not.toContain('script');
    expect(saved.body.data.updatedBy).toEqual({ id: member.userId, name: 'Bea Member' });

    // A guest reads but does not write; nobody outside a private project sees it.
    const read = await request(server()).get(note(open)).set(guest.auth).expect(200);
    expect(read.body.data.body).toContain('Ship it');
    await request(server()).put(note(open)).set(guest.auth).send({ body: 'x' }).expect(403);
    await request(server()).get(note(secret)).set(member.auth).expect(404);

    const cleared = await request(server())
      .put(note(open))
      .set(owner.auth)
      .send({ body: '' })
      .expect(200);
    expect(cleared.body.data.body).toBe('');
  });
});
