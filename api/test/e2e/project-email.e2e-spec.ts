import { API_PREFIX, WorkspaceRole, inboundAddress, taskRef } from '@coretask/contracts';
import request from 'supertest';

import { EmailQueue } from '../../src/jobs/email/email.queue';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

const DOMAIN = 'inbound.coretask.test';
const SECRET = 'test_only_inbound_email_secret';

/** Email to a project: its address, mail becoming tasks and comments, and the thread. */
describe('Project email (e2e)', () => {
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

  const deliver = (body: Record<string, unknown>) =>
    request(server()).post(url('/inbound/email')).set('X-Inbound-Secret', SECRET).send(body);

  const setUp = async () => {
    const owner = await register('Ada Owner');
    const member = await register('Bea Member');
    const guest = await register('Gus Guest');
    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(owner.auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.createMany({
      data: [
        { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
        { workspaceId, userId: guest.userId, role: WorkspaceRole.GUEST },
      ],
    });
    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner.auth)
      .send({ name: 'Maintenance' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const settingsUrl = url(`/workspaces/${workspaceId}/projects/${projectId}/email`);
    const settings = await request(server()).get(settingsUrl).set(owner.auth).expect(200);
    return {
      owner,
      member,
      guest,
      workspaceId,
      projectId,
      settingsUrl,
      settings: settings.body.data,
    };
  };

  it('gives a project an address, and turns members’ mail into tasks once', async () => {
    const { owner, member, guest, workspaceId, projectId, settingsUrl, settings } = await setUp();
    expect(settings).toMatchObject({
      receiving: true,
      isActive: true,
      acceptFrom: 'MEMBERS',
      addCollaborators: true,
      sendUpdates: true,
      receivedCount: 0,
      recent: [],
    });
    expect(settings.address).toMatch(new RegExp(`^[0-9a-f]{20}@${DOMAIN.replace(/\./g, '\\.')}$`));
    // Only editors see it.
    await request(server()).get(settingsUrl).set(guest.auth).expect(403);

    // No secret, or the wrong one, is turned away before anything is read.
    await request(server()).post(url('/inbound/email')).send({ to: settings.address }).expect(401);
    await request(server())
      .post(url('/inbound/email'))
      .auth('inbound', 'not-the-secret')
      .send({ to: settings.address })
      .expect(401);

    const message = {
      from: `Bea Member <${member.email}>`,
      to: settings.address,
      cc: `${owner.email}, Tenant <tenant@example.org>`,
      subject: 'Leak under the sink in 4B',
      text: 'Water on the floor.\nPlease send someone.',
      messageId: '<leak-4b@example.org>',
      attachments: [
        {
          filename: 'notes.txt',
          contentType: 'text/plain',
          content: Buffer.from('drip').toString('base64'),
        },
        { filename: 'run.exe', contentType: 'application/x-msdownload', content: 'AAAA' },
      ],
    };
    // Basic auth carries the secret as well as the header does.
    const created = await request(server())
      .post(url('/inbound/email'))
      .auth('inbound', SECRET)
      .send(message)
      .expect(200);
    expect(created.body.data.results).toEqual([
      expect.objectContaining({ outcome: 'TASK_CREATED', address: settings.address }),
    ]);
    const taskId = created.body.data.results[0].taskId as string;

    const task = await context.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      include: { followers: true, attachments: true },
    });
    expect(task).toMatchObject({
      title: 'Leak under the sink in 4B',
      projectId,
      createdById: member.userId,
    });
    expect(task.description).toContain('Water on the floor.');
    expect(task.description).toContain('Not kept from the email: run.exe');
    expect(task.description).not.toContain('Emailed by');
    expect(task.attachments.map((file) => file.filename)).toEqual(['notes.txt']);
    expect(task.followers.map((row) => row.userId).sort()).toEqual(
      [owner.userId, member.userId].sort(),
    );
    const recipients = await context.prisma.taskEmailRecipient.findMany({ where: { taskId } });
    expect(recipients.map((row) => row.address)).toEqual(['tenant@example.org']);

    // The provider's retry is the same message: no second task.
    const again = await deliver(message).expect(200);
    expect(again.body.data.results[0].outcome).toBe('DUPLICATE');
    expect(await context.prisma.task.count({ where: { projectId } })).toBe(1);

    // A stranger is refused while only members may write, and the panel says why.
    const stranger = await deliver({
      from: 'someone@example.org',
      to: settings.address,
      subject: 'Hello',
      text: 'Is this the right place?',
    }).expect(200);
    expect(stranger.body.data.results[0]).toMatchObject({
      outcome: 'REJECTED',
      reason: 'Only members of the workspace can email this project.',
    });
    const after = await request(server()).get(settingsUrl).set(owner.auth).expect(200);
    expect(after.body.data.receivedCount).toBe(2);
    expect(after.body.data.recent.map((row: { outcome: string }) => row.outcome)).toEqual([
      'REJECTED',
      'TASK_CREATED',
    ]);

    // Opened to anyone, the stranger's mail is a task under the address's author.
    await request(server())
      .patch(settingsUrl)
      .set(owner.auth)
      .send({ acceptFrom: 'ANYONE' })
      .expect(200);
    const open = await deliver({
      from: 'Someone <someone@example.org>',
      to: `Maintenance <${settings.address}>`,
      subject: 'Broken gate',
      text: 'The side gate will not latch.',
    }).expect(200);
    const openTask = await context.prisma.task.findUniqueOrThrow({
      where: { id: open.body.data.results[0].taskId as string },
    });
    expect(openTask.createdById).toBe(owner.userId);
    expect(openTask.description).toContain('Emailed by someone@example.org.');

    // Switched off, the address takes nothing; mail to other addresses is ignored.
    await request(server())
      .patch(settingsUrl)
      .set(owner.auth)
      .send({ isActive: false })
      .expect(200);
    const off = await deliver({
      from: member.email,
      to: `${settings.address}, other@elsewhere.org`,
      subject: 'Anyone?',
      text: 'x',
    }).expect(200);
    expect(off.body.data.results).toEqual([
      expect.objectContaining({ outcome: 'REJECTED', reason: 'The address is turned off.' }),
    ]);
    expect(workspaceId).toBeTruthy();
  });

  it('takes replies as comments and writes comments back to the thread', async () => {
    const { owner, member, workspaceId, projectId, settingsUrl, settings } = await setUp();
    const token = (settings.address as string).split('@')[0] as string;
    const enqueue = jest
      .spyOn(context.app.get(EmailQueue), 'enqueueMessage')
      .mockResolvedValue(undefined);

    const created = await deliver({
      from: member.email,
      to: settings.address,
      cc: 'tenant@example.org',
      subject: 'Leak under the sink',
      text: 'Water on the floor.',
    }).expect(200);
    const taskId = created.body.data.results[0].taskId as string;
    const replyAddress = inboundAddress(token, DOMAIN, taskId);

    // A member's comment goes out to the tenant, answerable by reply.
    await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks/${taskId}/comments`))
      .set(owner.auth)
      .send({ body: 'A plumber is booked for Tuesday.' })
      .expect(201);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'tenant@example.org',
        subject: 'Re: Leak under the sink',
        replyTo: replyAddress,
        text: expect.stringContaining('A plumber is booked for Tuesday.'),
      }),
    );
    enqueue.mockClear();

    // The tenant's reply is a comment, without the message it quotes, and is
    // not mailed back to them.
    const replied = await deliver({
      from: 'Tenant <tenant@example.org>',
      to: replyAddress,
      subject: 'Re: Leak under the sink',
      text: 'Tuesday works, thank you.\n\nOn Mon, Oct 12, 2026 at 9:00 AM CoreTask wrote:\n> A plumber is booked',
    }).expect(200);
    expect(replied.body.data.results[0]).toMatchObject({ outcome: 'COMMENTED', taskId });
    expect(enqueue).not.toHaveBeenCalled();

    // A member replying by email comments as themselves, and the tenant hears.
    await deliver({
      from: member.email,
      to: replyAddress,
      subject: 'Re: Leak under the sink',
      text: 'I will let them in.',
    }).expect(200);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ to: 'tenant@example.org' }));

    const comments = await context.prisma.comment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'asc' },
    });
    expect(comments).toHaveLength(3);
    expect(comments[1]?.authorId).toBe(owner.userId);
    expect(comments[1]?.body).toContain('tenant@example.org replied by email');
    expect(comments[1]?.body).toContain('Tuesday works, thank you.');
    expect(comments[1]?.body).not.toContain('A plumber is booked');
    expect(comments[2]).toMatchObject({ authorId: member.userId });

    // Someone off the thread cannot reply; nor can anyone to a task elsewhere.
    const outsider = await deliver({
      from: 'nosy@example.org',
      to: replyAddress,
      subject: 'Re: x',
      text: 'Me too',
    }).expect(200);
    expect(outsider.body.data.results[0].outcome).toBe('REJECTED');
    const other = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(owner.auth)
      .send({ title: 'Elsewhere' })
      .expect(201);
    const elsewhere = await deliver({
      from: member.email,
      to: inboundAddress(token, DOMAIN, other.body.data.id as string),
      subject: 'Re: Elsewhere',
      text: 'Hi',
    }).expect(200);
    expect(elsewhere.body.data.results[0]).toMatchObject({
      outcome: 'REJECTED',
      reason: 'That task is not in this project.',
    });
    expect(taskRef(taskId)).toHaveLength(32);

    // A new address leaves the old one, and its reply addresses, answering nothing.
    const reset = await request(server())
      .post(`${settingsUrl}/address`)
      .set(owner.auth)
      .expect(200);
    expect(reset.body.data.address).not.toBe(settings.address);
    const stale = await deliver({
      from: member.email,
      to: replyAddress,
      subject: 'Re: Leak',
      text: 'Still there?',
    }).expect(200);
    expect(stale.body.data.results).toEqual([expect.objectContaining({ outcome: 'UNKNOWN' })]);
    expect(projectId).toBeTruthy();
  });
});
