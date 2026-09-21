import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { API_PREFIX, AutomationTrigger } from '@coretask/contracts';
import request from 'supertest';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';
import { WebhookDeliveryService } from '../../src/modules/webhooks/webhook-delivery.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * The "Send a webhook" action, from a published rule to a POST on a listener.
 *
 * The runner returns the request rather than sending; the processor would
 * queue it and the worker deliver it. Both halves are driven directly here,
 * the same code paths the queue invokes.
 */
describe('Automation: send a webhook (e2e)', () => {
  let context: TestContext;
  let runner: AutomationRunnerService;
  let deliveries: WebhookDeliveryService;
  let listener: Server;
  let listenerUrl: string;
  let received: { headers: Record<string, string | string[] | undefined>; body: string }[] = [];

  beforeAll(async () => {
    context = await createTestContext();
    // The runner lives in the worker, not the API app; build it the way the
    // automations spec does, with a relay that goes nowhere.
    runner = new AutomationRunnerService(context.prisma, {
      toProject: async () => undefined,
    } as never);
    deliveries = context.app.get(WebhookDeliveryService);

    listener = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = 200;
        res.end('{"ok":true}');
      });
    });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    listenerUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/rule`;
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
    received = [];
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;

  interface Scope {
    token: string;
    userId: string;
    workspaceId: string;
    projectId: string;
    sectionId: string;
    taskId: string;
  }

  const setupScope = async (): Promise<Scope> => {
    const registered = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Owner', email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    const token = registered.body.data.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(auth)
      .send({ name: 'Platform' })
      .expect(201);
    const sectionId = project.body.data.sections[0].id as string;

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(auth)
      .send({ title: 'Ruled', sectionId })
      .expect(201);

    return {
      token,
      userId: registered.body.data.user.id as string,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId,
      taskId: task.body.data.id as string,
    };
  };

  const auth = (scope: Scope) => ({ Authorization: `Bearer ${scope.token}` });
  const rulesUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);

  const createEndpoint = async (scope: Scope, overrides: Record<string, unknown> = {}) => {
    const response = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/webhooks`))
      .set(auth(scope))
      .send({ name: 'rule-listener', url: listenerUrl, events: ['task.created'], ...overrides })
      .expect(201);
    return response.body.data as { endpoint: { id: string }; secret: string };
  };

  const draftRule = async (scope: Scope, configuration: Record<string, unknown>) => {
    const created = await request(server())
      .post(rulesUrl(scope))
      .set(auth(scope))
      .send({
        name: 'Tell n8n',
        triggerType: 'TASK_MOVED_TO_SECTION',
        triggerConfig: { sectionId: scope.sectionId },
        nodes: [
          { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', configuration: {} },
          { nodeType: 'ACTION', subtype: 'SEND_WEBHOOK', configuration },
        ],
      })
      .expect(201);
    return created.body.data.id as string;
  };

  const publish = (scope: Scope, ruleId: string) =>
    request(server())
      .post(`${rulesUrl(scope)}/${ruleId}/publish`)
      .set(auth(scope));

  const moveEvent = (scope: Scope): AutomationEvent => ({
    eventId: randomUUID(),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    trigger: AutomationTrigger.TASK_MOVED_TO_SECTION,
    entityType: 'TASK',
    entityId: scope.taskId,
    actorId: scope.userId,
    after: { sectionId: scope.sectionId },
    correlationId: randomUUID(),
    depth: 0,
  });

  it('asks for a signed delivery to a registered endpoint, and it arrives with the rule named', async () => {
    const scope = await setupScope();
    const { endpoint } = await createEndpoint(scope);
    const ruleId = await draftRule(scope, {
      endpointId: endpoint.id,
      extraFields: [
        { key: 'flow', value: 'renewals' },
        { key: '', value: 'dropped' },
      ],
    });
    await publish(scope, ruleId).expect(200);

    const result = await runner.handle(moveEvent(scope));
    expect(result.executed).toBe(1);
    expect(result.webhooks).toHaveLength(1);
    expect(result.webhooks[0]).toMatchObject({
      ruleId,
      endpointId: endpoint.id,
      url: listenerUrl,
      entityId: scope.taskId,
      trigger: 'TASK_MOVED_TO_SECTION',
      extra: { flow: 'renewals' },
    });

    // What the worker does with the request.
    expect(await deliveries.ruleSend(result.webhooks[0]!)).toEqual({ queued: true });

    const listed = await request(server())
      .get(url(`/workspaces/${scope.workspaceId}/webhook-deliveries?ruleId=${ruleId}`))
      .set(auth(scope))
      .expect(200);
    expect(listed.body.data.items).toHaveLength(1);
    const deliveryId = listed.body.data.items[0].id as string;
    expect(listed.body.data.items[0]).toMatchObject({
      eventType: 'automation.webhook',
      endpointId: endpoint.id,
      ruleId,
    });

    await expect(deliveries.deliver(deliveryId, 1)).resolves.toEqual({ status: 'delivered' });

    expect(received).toHaveLength(1);
    const payload = JSON.parse(received[0]!.body);
    expect(payload).toMatchObject({
      type: 'automation.webhook',
      causedByRuleId: ruleId,
      data: {
        rule: { id: ruleId, name: 'Tell n8n' },
        trigger: 'TASK_MOVED_TO_SECTION',
        extra: { flow: 'renewals' },
      },
    });
    expect(payload.data.task.id).toEqual(scope.taskId);
    expect(received[0]!.headers['x-coretask-signature']).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
  });

  it('sends unsigned to an ad-hoc URL', async () => {
    const scope = await setupScope();
    const ruleId = await draftRule(scope, { url: `${listenerUrl}?adhoc=1` });
    await publish(scope, ruleId).expect(200);

    const result = await runner.handle(moveEvent(scope));
    expect(result.webhooks[0]).toMatchObject({ endpointId: null, url: `${listenerUrl}?adhoc=1` });

    await deliveries.ruleSend(result.webhooks[0]!);
    const listed = await request(server())
      .get(url(`/workspaces/${scope.workspaceId}/webhook-deliveries?ruleId=${ruleId}`))
      .set(auth(scope))
      .expect(200);
    await deliveries.deliver(listed.body.data.items[0].id as string, 1);

    expect(received).toHaveLength(1);
    expect(received[0]!.headers['x-coretask-signature']).toBeUndefined();
    expect(received[0]!.headers['x-coretask-event']).toEqual('automation.webhook');
  });

  it('refuses to publish a step pointing at another workspace’s endpoint or nowhere', async () => {
    const scope = await setupScope();
    const other = await setupScope();
    const { endpoint: foreign } = await createEndpoint(other);

    const elsewhere = await draftRule(scope, { endpointId: foreign.id });
    const refused = await publish(scope, elsewhere).expect(400);
    expect(JSON.stringify(refused.body)).toMatch(/no longer in this workspace/);

    const nowhere = await draftRule(scope, {});
    const incomplete = await publish(scope, nowhere).expect(400);
    expect(JSON.stringify(incomplete.body)).toMatch(/Choose a webhook endpoint or enter a URL/);

    const broken = await draftRule(scope, { url: 'ftp://files.example.com/drop' });
    const badUrl = await publish(scope, broken).expect(400);
    expect(JSON.stringify(badUrl.body)).toMatch(/https:\/\/ or http:\/\//);
  });

  it('fails the action at run time when the endpoint has since been disabled', async () => {
    const scope = await setupScope();
    const { endpoint } = await createEndpoint(scope);
    const ruleId = await draftRule(scope, { endpointId: endpoint.id });
    await publish(scope, ruleId).expect(200);

    await request(server())
      .patch(url(`/workspaces/${scope.workspaceId}/webhooks/${endpoint.id}`))
      .set(auth(scope))
      .send({ enabled: false })
      .expect(200);

    const result = await runner.handle(moveEvent(scope));
    expect(result.webhooks).toHaveLength(0);

    const log = await context.prisma.automationExecutionLog.findFirst({
      where: { subtype: 'SEND_WEBHOOK' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.succeeded).toBe(false);
    expect(log?.message).toMatch(/disabled/);
  });
});
