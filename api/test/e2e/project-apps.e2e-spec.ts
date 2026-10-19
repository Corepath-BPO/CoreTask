import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { API_PREFIX, AutomationTrigger, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import { AppConfigService } from '../../src/config/app-config.service';
import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { WebhookDeliveryService } from '../../src/modules/webhooks/webhook-delivery.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Customize › Apps: a chat channel a project posts to. Like the webhooks
 * suite, it drives the delivery service by hand, against a listener standing
 * in for Slack (private URLs are allowed under test, which also lifts the
 * check that the URL is Slack's own).
 */
describe('Project apps (e2e)', () => {
  let context: TestContext;
  let deliveries: WebhookDeliveryService;
  let listener: Server;
  let listenerUrl: string;
  let received: Record<string, unknown>[] = [];

  beforeAll(async () => {
    context = await createTestContext();
    deliveries = context.app.get(WebhookDeliveryService);
    listener = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push(JSON.parse(body) as Record<string, unknown>);
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    listenerUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/services/T0/B0/x`;
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
    received = [];
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
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

  const taskEvent = (
    workspaceId: string,
    projectId: string,
    taskId: string,
    actorId: string,
  ): AutomationEvent => ({
    eventId: randomUUID(),
    workspaceId,
    projectId,
    trigger: AutomationTrigger.TASK_CREATED,
    entityType: 'TASK',
    entityId: taskId,
    actorId,
    after: {},
    correlationId: randomUUID(),
    depth: 0,
  });

  /** Sends every delivery still pending for the endpoint, oldest first. */
  const flush = async (endpointId: string) => {
    const pending = await context.prisma.webhookDelivery.findMany({
      where: { endpointId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    for (const delivery of pending) await deliveries.deliver(delivery.id, 1);
  };

  it('posts a project’s updates to its chat app, as that app’s messages', async () => {
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
    const other = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(owner.auth)
      .send({ name: 'Leasing' })
      .expect(201);
    const appsUrl = url(`/workspaces/${workspaceId}/projects/${projectId}/apps`);

    await request(server()).get(appsUrl).set(guest.auth).expect(403);

    // Where only the tool's own address will do, a stranger's URL is refused.
    const config = context.app.get(AppConfigService);
    const webhooks = config.webhooks;
    jest.spyOn(config, 'webhooks', 'get').mockReturnValue({ ...webhooks, allowPrivateUrls: false });
    const refused = await request(server())
      .post(appsUrl)
      .set(member.auth)
      .send({ app: 'SLACK', url: 'https://example.org/hook' })
      .expect(400);
    expect(refused.body.error.message).toContain('not a Slack webhook URL');
    jest.restoreAllMocks();

    // An editor connects Slack; the channel hears hello at once.
    const created = await request(server())
      .post(appsUrl)
      .set(member.auth)
      .send({ app: 'SLACK', url: listenerUrl, name: '#maintenance' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      app: 'SLACK',
      name: '#maintenance',
      enabled: true,
      events: ['task.created', 'task.completed', 'comment.created', 'project.status_updated'],
      urlHint: expect.stringMatching(/^127\.0\.0\.1:\d+\/…B0\/x$/),
    });
    const appId = created.body.data.id as string;
    await flush(appId);
    expect(received).toEqual([
      expect.objectContaining({ text: 'CoreTask will post updates from Maintenance here.' }),
    ]);

    // A task added here is posted as a Slack message with a link to it.
    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(owner.auth)
      .send({ title: 'Replace the hallway bulb', projectId })
      .expect(201);
    const taskId = task.body.data.id as string;
    expect(
      await deliveries.fanOut(taskEvent(workspaceId, projectId, taskId, owner.userId)),
    ).toEqual({ deliveries: 1 });
    await flush(appId);
    const message = received[1] as { text: string; blocks: { text?: { text: string } }[] };
    expect(message.text).toBe('Ada Owner added “Replace the hallway bulb”');
    expect(message.blocks[0]?.text?.text).toContain(
      `/projects/${projectId}/list?task=${taskId}|Replace the hallway bulb>`,
    );

    // A status update is posted to the channel too.
    await request(server())
      .post(url(`/workspaces/${workspaceId}/projects/${projectId}/status-updates`))
      .set(owner.auth)
      .send({ status: 'ON_TRACK', title: 'Week 42', summary: 'Bulbs replaced.' })
      .expect(201);
    await flush(appId);
    expect((received.at(-1) as { text: string }).text).toContain(
      'Ada Owner posted a status update: “On track — Week 42”',
    );

    // Another project's work is not this channel's business.
    const elsewhere = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(owner.auth)
      .send({ title: 'Renew lease', projectId: other.body.data.id })
      .expect(201);
    expect(
      await deliveries.fanOut(
        taskEvent(workspaceId, other.body.data.id as string, elsewhere.body.data.id, owner.userId),
      ),
    ).toEqual({ deliveries: 0 });

    // The admin's webhook list shows it as the app it is.
    const hooks = await request(server())
      .get(url(`/workspaces/${workspaceId}/webhooks`))
      .set(owner.auth)
      .expect(200);
    expect(hooks.body.data).toEqual([
      expect.objectContaining({
        id: appId,
        app: 'SLACK',
        project: { id: projectId, name: 'Maintenance' },
      }),
    ]);

    // Told only about completions, it hears nothing of new tasks.
    await request(server())
      .patch(`${appsUrl}/${appId}`)
      .set(member.auth)
      .send({ events: ['task.completed'] })
      .expect(200);
    expect(
      await deliveries.fanOut(taskEvent(workspaceId, projectId, taskId, owner.userId)),
    ).toEqual({ deliveries: 0 });
    await request(server())
      .patch(`${appsUrl}/${appId}`)
      .set(member.auth)
      .send({ events: [] })
      .expect(400);

    // A test message on demand; none while it is switched off.
    await request(server()).post(`${appsUrl}/${appId}/test`).set(member.auth).expect(200);
    await flush(appId);
    expect(received.at(-1)).toMatchObject({
      text: 'A test from CoreTask: updates from Maintenance will appear here.',
    });
    await request(server())
      .patch(`${appsUrl}/${appId}`)
      .set(member.auth)
      .send({ enabled: false })
      .expect(200);
    await request(server()).post(`${appsUrl}/${appId}/test`).set(member.auth).expect(400);

    await request(server()).delete(`${appsUrl}/${appId}`).set(member.auth).expect(204);
    const after = await request(server()).get(appsUrl).set(member.auth).expect(200);
    expect(after.body.data).toEqual([]);
  });
});
