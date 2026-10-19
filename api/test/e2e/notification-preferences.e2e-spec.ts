import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/** Notification emails: the kinds someone chose, sent beside the inbox entry. */
describe('Notification preferences (e2e)', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestContext();
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;

  const register = async (name: string) => {
    const email = uniqueEmail();
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email, password: VALID_PASSWORD })
      .expect(201);
    return {
      email: email.toLowerCase(),
      auth: { Authorization: `Bearer ${response.body.data.accessToken as string}` },
      userId: response.body.data.user.id as string,
    };
  };

  it('emails assignments by default, and stops when told to', async () => {
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
    const prefs = url(`/workspaces/${workspaceId}/notification-preferences`);
    const enqueue = jest
      .spyOn(context.app.get(EmailQueue), 'enqueueMessage')
      .mockResolvedValue(undefined);

    const defaults = await request(server()).get(prefs).set(member.auth).expect(200);
    expect(defaults.body.data).toEqual({
      emailGroups: ['ASSIGNED', 'MENTIONED'],
      emailAddress: member.email,
    });

    const assign = (title: string) =>
      request(server())
        .post(url(`/workspaces/${workspaceId}/tasks`))
        .set(owner.auth)
        .send({ title, assigneeId: member.userId })
        .expect(201);

    await assign('Fix the gate');
    const sent = enqueue.mock.calls.map(([message]) => message);
    expect(sent).toEqual([
      expect.objectContaining({
        to: member.email,
        text: expect.stringContaining('Open in CoreTask:'),
      }),
    ]);
    expect(sent[0]?.subject).toContain('Fix the gate');
    enqueue.mockClear();

    const off = await request(server())
      .put(prefs)
      .set(member.auth)
      .send({ emailGroups: ['COMMENTS'] })
      .expect(200);
    expect(off.body.data.emailGroups).toEqual(['COMMENTS']);
    await request(server())
      .put(prefs)
      .set(member.auth)
      .send({ emailGroups: ['LOUD'] })
      .expect(422);

    await assign('Paint the hallway');
    expect(enqueue).not.toHaveBeenCalled();
    // The inbox still has it: email is a second channel, not a replacement.
    const inbox = await context.prisma.notification.count({ where: { userId: member.userId } });
    expect(inbox).toBe(2);
  });
});
