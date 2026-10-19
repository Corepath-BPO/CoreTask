import { API_PREFIX, DEFAULT_HOME_WIDGETS } from '@coretask/contracts';
import request from 'supertest';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Home: each person's widgets and notepad, per workspace, read by nobody else. */
describe('Home (e2e)', () => {
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

  it('starts on the defaults, keeps a person’s choices and notepad, and resets', async () => {
    const ada = await register('Ada');
    const bea = await register('Bea');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(ada.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: bea.userId, role: 'MEMBER' },
    });
    const home = url(`/workspaces/${workspaceId}/home`);

    const fresh = await request(server()).get(home).set(ada.auth).expect(200);
    expect(fresh.body.data).toEqual({
      widgets: [...DEFAULT_HOME_WIDGETS],
      notepad: '',
      customized: false,
    });

    const arranged = await request(server())
      .put(home)
      .set(ada.auth)
      .send({ widgets: ['NOTEPAD', 'ASSIGNED', 'NOTEPAD'], notepad: 'Call the landlord' })
      .expect(200);
    // Each widget once, in the order given.
    expect(arranged.body.data).toEqual({
      widgets: ['NOTEPAD', 'ASSIGNED'],
      notepad: 'Call the landlord',
      customized: true,
    });

    // Bea's Home is her own.
    const beas = await request(server()).get(home).set(bea.auth).expect(200);
    expect(beas.body.data.customized).toBe(false);
    expect(beas.body.data.notepad).toBe('');

    await request(server())
      .put(home)
      .set(ada.auth)
      .send({ widgets: ['SIDEBAR'] })
      .expect(422);

    // A reset brings the widgets back and keeps what was written.
    const reset = await request(server()).delete(home).set(ada.auth).expect(200);
    expect(reset.body.data).toMatchObject({
      widgets: [...DEFAULT_HOME_WIDGETS],
      notepad: 'Call the landlord',
    });
  });
});
