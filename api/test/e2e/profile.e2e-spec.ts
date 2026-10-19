import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** A person's own profile and time off, and how members see them. */
describe('Profile (e2e)', () => {
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

  it('keeps a profile and time off, and shows them to the workspace', async () => {
    const ada = await register('Ada Owner');
    const bea = await register('Bea Member');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(ada.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: bea.userId, role: WorkspaceRole.MEMBER },
    });

    const fresh = await request(server()).get(url('/auth/me')).set(bea.auth).expect(200);
    expect(fresh.body.data).toMatchObject({
      pronouns: null,
      jobTitle: null,
      outOfOffice: null,
    });

    const updated = await request(server())
      .patch(url('/users/me'))
      .set(bea.auth)
      .send({
        name: '  Bea Lin  ',
        pronouns: 'she/her',
        jobTitle: ' Leasing manager ',
        department: 'Operations',
        aboutMe: 'Ask me about renewals.',
        timezone: 'America/Chicago',
        outOfOffice: { from: '2026-10-19', until: '2026-10-23', note: 'Back Monday' },
      })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      name: 'Bea Lin',
      pronouns: 'she/her',
      jobTitle: 'Leasing manager',
      department: 'Operations',
      timezone: 'America/Chicago',
      outOfOffice: { from: '2026-10-19', until: '2026-10-23', note: 'Back Monday' },
    });

    // Members see the title and the time off beside the name.
    const members = await request(server())
      .get(url(`/workspaces/${workspaceId}/members`))
      .set(ada.auth)
      .expect(200);
    const row = (members.body.data as { user: Record<string, unknown> }[]).find(
      (member) => member.user.id === bea.userId,
    );
    expect(row?.user).toMatchObject({
      name: 'Bea Lin',
      jobTitle: 'Leasing manager',
      pronouns: 'she/her',
      outOfOffice: { from: '2026-10-19', until: '2026-10-23' },
    });

    // Clearing: an empty box and a null period.
    const cleared = await request(server())
      .patch(url('/users/me'))
      .set(bea.auth)
      .send({ jobTitle: '   ', outOfOffice: null })
      .expect(200);
    expect(cleared.body.data).toMatchObject({
      jobTitle: null,
      outOfOffice: null,
      pronouns: 'she/her',
    });

    // What is refused.
    await request(server()).patch(url('/users/me')).set(bea.auth).send({ name: '' }).expect(422);
    await request(server())
      .patch(url('/users/me'))
      .set(bea.auth)
      .send({ timezone: 'Mars/Olympus' })
      .expect(400);
    await request(server())
      .patch(url('/users/me'))
      .set(bea.auth)
      .send({ outOfOffice: { from: '2026-10-23', until: '2026-10-19' } })
      .expect(400);
    await request(server())
      .patch(url('/users/me'))
      .set(bea.auth)
      .send({ outOfOffice: { from: 'next week', until: '2026-10-19' } })
      .expect(422);
    await request(server()).patch(url('/users/me')).send({ name: 'Nobody' }).expect(401);
  });
});
