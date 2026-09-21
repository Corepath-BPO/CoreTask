import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  API_PREFIX,
  AutomationTrigger,
  WEBHOOK_EVENT_HEADER,
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WorkspaceRole,
} from '@coretask/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';

import { QueueName, WebhookJob } from '../../src/jobs/queue-names';
import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { verifyWebhookSignature } from '../../src/modules/webhooks/lib/signature';
import { WebhookDeliveryService } from '../../src/modules/webhooks/webhook-delivery.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

interface Received {
  headers: IncomingMessage['headers'];
  body: string;
}

/**
 * Outbound webhooks, end to end: an endpoint is registered, a task is created,
 * and a listener on this machine receives a signed POST for it.
 *
 * Delivery runs in the worker, which is not part of the test app, so the spec
 * drives `WebhookDeliveryService` directly for the fan-out and the HTTP call —
 * the same code the processor invokes — while still checking the API side put
 * the job on the queue.
 */
describe('Webhooks (e2e)', () => {
  let context: TestContext;
  let queue: Queue<AutomationEvent>;
  let deliveries: WebhookDeliveryService;
  let listener: Server;
  let listenerUrl: string;
  let received: Received[] = [];
  let respondWith = 200;

  beforeAll(async () => {
    context = await createTestContext();
    queue = context.app.get<Queue<AutomationEvent>>(getQueueToken(QueueName.WEBHOOK));
    deliveries = context.app.get(WebhookDeliveryService);

    listener = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = respondWith;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: respondWith < 300 }));
      });
    });
    await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve));
    listenerUrl = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/hook`;
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
    received = [];
    respondWith = 200;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;

  interface Actor {
    token: string;
    userId: string;
  }

  interface Scope {
    owner: Actor;
    workspaceId: string;
    projectId: string;
    sectionId: string;
  }

  const registerUser = async (name = 'Test User'): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);

    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser('Workspace Owner');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Acme Product' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Platform Foundation' })
      .expect(201);

    return {
      owner,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: project.body.data.sections[0].id as string,
    };
  };

  const hooksUrl = (scope: Scope) => url(`/workspaces/${scope.workspaceId}/webhooks`);
  const deliveriesUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/webhook-deliveries`);
  const auth = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  const createEndpoint = async (
    scope: Scope,
    body: Record<string, unknown> = {
      name: 'listener',
      url: listenerUrl,
      events: ['task.created'],
    },
  ) => {
    const response = await request(server())
      .post(hooksUrl(scope))
      .set(auth(scope.owner))
      .send(body)
      .expect(201);

    return response.body.data as {
      endpoint: { id: string; enabled: boolean; events: string[]; url: string };
      secret: string;
    };
  };

  const createTask = async (scope: Scope, title = 'Filed for the webhook') => {
    const response = await request(server())
      .post(url(`/workspaces/${scope.workspaceId}/tasks`))
      .set(auth(scope.owner))
      .send({ title, sectionId: scope.sectionId })
      .expect(201);

    return response.body.data.id as string;
  };

  const taskCreatedEvent = (scope: Scope, taskId: string): AutomationEvent => ({
    eventId: randomUUID(),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    trigger: AutomationTrigger.TASK_CREATED,
    entityType: 'TASK',
    entityId: taskId,
    actorId: scope.owner.userId,
    after: { title: 'Filed for the webhook', sectionId: scope.sectionId },
    correlationId: randomUUID(),
    depth: 0,
  });

  // -------------------------------------------------------------------------
  describe('managing endpoints', () => {
    it('returns the secret once and never lists it', async () => {
      const scope = await setupScope();
      const created = await createEndpoint(scope);

      expect(created.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
      expect(created.endpoint.enabled).toBe(true);
      expect(created.endpoint.events).toEqual(['task.created']);

      const list = await request(server()).get(hooksUrl(scope)).set(auth(scope.owner)).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(JSON.stringify(list.body)).not.toContain(created.secret);
      expect(JSON.stringify(list.body)).not.toContain('"secret"');
    });

    it('refuses schemes and credentials CoreTask will not send to', async () => {
      const scope = await setupScope();

      for (const bad of ['ftp://example.com/x', 'https://user:pw@example.com/x']) {
        const response = await request(server())
          .post(hooksUrl(scope))
          .set(auth(scope.owner))
          .send({ name: 'bad', url: bad, events: ['task.created'] })
          .expect(422);
        expect(response.body.error.code).toEqual('WEBHOOK_URL_NOT_ALLOWED');
      }

      const noEvents = await request(server())
        .post(hooksUrl(scope))
        .set(auth(scope.owner))
        .send({ name: 'none', url: listenerUrl, events: [] })
        .expect(422);
      expect(noEvents.body.error.code).toEqual('VALIDATION_FAILED');
    });

    it('is workspace administration: members and API keys are refused', async () => {
      const scope = await setupScope();
      const member = await registerUser('Member');
      await context.prisma.workspaceMember.create({
        data: { workspaceId: scope.workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
      });

      const asMember = await request(server()).get(hooksUrl(scope)).set(auth(member)).expect(403);
      expect(asMember.body.error.code).toEqual('INSUFFICIENT_WORKSPACE_ROLE');

      const key = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/api-keys`))
        .set(auth(scope.owner))
        .send({ name: 'n8n', role: 'MANAGER' })
        .expect(201);
      const asKey = await request(server())
        .get(hooksUrl(scope))
        .set('X-API-Key', key.body.data.secret as string)
        .expect(403);
      expect(asKey.body.error.code).toEqual('API_KEY_NOT_ALLOWED');
    });

    it('updates, rotates, tests and deletes', async () => {
      const scope = await setupScope();
      const created = await createEndpoint(scope);
      const endpointUrl = `${hooksUrl(scope)}/${created.endpoint.id}`;

      const paused = await request(server())
        .patch(endpointUrl)
        .set(auth(scope.owner))
        .send({ enabled: false, events: ['task.created', 'task.completed'] })
        .expect(200);
      expect(paused.body.data.enabled).toBe(false);
      expect(paused.body.data.events).toEqual(['task.created', 'task.completed']);

      const whilePaused = await request(server())
        .post(`${endpointUrl}/test`)
        .set(auth(scope.owner))
        .expect(400);
      expect(whilePaused.body.error.message).toMatch(/enable/i);

      const rotated = await request(server())
        .post(`${endpointUrl}/rotate-secret`)
        .set(auth(scope.owner))
        .expect(200);
      expect(rotated.body.data.secret).toMatch(/^whsec_/);
      expect(rotated.body.data.secret).not.toEqual(created.secret);

      await request(server())
        .patch(endpointUrl)
        .set(auth(scope.owner))
        .send({ enabled: true })
        .expect(200);

      const test = await request(server())
        .post(`${endpointUrl}/test`)
        .set(auth(scope.owner))
        .expect(202);
      const deliveryId = test.body.data.deliveryId as string;

      const listed = await request(server())
        .get(`${deliveriesUrl(scope)}?endpointId=${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(listed.body.data.items).toHaveLength(1);
      expect(listed.body.data.items[0]).toMatchObject({
        id: deliveryId,
        eventType: 'ping',
        status: 'PENDING',
        endpointName: 'listener',
      });
      expect(listed.body.data.items[0].payload).toBeUndefined();

      const detail = await request(server())
        .get(`${deliveriesUrl(scope)}/${deliveryId}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(detail.body.data.payload.type).toEqual('ping');
      expect(detail.body.data.payload.actor.id).toEqual(scope.owner.userId);

      await request(server()).delete(endpointUrl).set(auth(scope.owner)).expect(204);
      await request(server()).get(endpointUrl).set(auth(scope.owner)).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('delivering', () => {
    it('queues a fan-out when a task is created, and delivers a signed POST', async () => {
      const scope = await setupScope();
      const created = await createEndpoint(scope);
      const taskId = await createTask(scope);

      // The API side: creating the task put a fan-out job on the webhook queue.
      const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed']);
      expect(
        jobs.some((job) => job.name === WebhookJob.FAN_OUT && job.data.entityId === taskId),
      ).toBe(true);

      // The worker side, driven directly.
      const fanned = await deliveries.fanOut(taskCreatedEvent(scope, taskId));
      expect(fanned).toEqual({ deliveries: 1 });

      const pending = await request(server())
        .get(`${deliveriesUrl(scope)}?endpointId=${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      const deliveryId = pending.body.data.items[0].id as string;
      expect(pending.body.data.items[0].status).toEqual('PENDING');

      await expect(deliveries.deliver(deliveryId, 1)).resolves.toEqual({ status: 'delivered' });

      expect(received).toHaveLength(1);
      const hit = received[0] as Received;
      expect(hit.headers[WEBHOOK_EVENT_HEADER]).toEqual('task.created');
      expect(hit.headers['content-type']).toEqual('application/json');
      expect(
        verifyWebhookSignature(
          created.secret,
          hit.headers[WEBHOOK_SIGNATURE_HEADER] as string,
          hit.body,
        ),
      ).toBe(true);

      const payload = JSON.parse(hit.body);
      expect(payload).toMatchObject({
        type: 'task.created',
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        actor: { id: scope.owner.userId, kind: 'user' },
        causedByRuleId: null,
        changes: null,
      });
      expect(payload.data.task.id).toEqual(taskId);
      expect(hit.headers[WEBHOOK_EVENT_ID_HEADER]).toEqual(payload.id);

      const detail = await request(server())
        .get(`${deliveriesUrl(scope)}/${deliveryId}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(detail.body.data).toMatchObject({
        status: 'SUCCEEDED',
        attempt: 1,
        responseStatus: 200,
      });
      expect(detail.body.data.attempts).toHaveLength(1);
      expect(detail.body.data.deliveredAt).not.toBeNull();

      const endpoint = await request(server())
        .get(`${hooksUrl(scope)}/${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(endpoint.body.data).toMatchObject({
        lastDeliveryStatus: 'SUCCEEDED',
        consecutiveFailures: 0,
      });
    });

    it('only fans out to endpoints subscribed to the event, in scope', async () => {
      const scope = await setupScope();
      await createEndpoint(scope, {
        name: 'completions',
        url: listenerUrl,
        events: ['task.completed'],
      });
      const other = await setupScope();
      await createEndpoint(other, {
        name: 'elsewhere',
        url: listenerUrl,
        events: ['task.created'],
      });
      const taskId = await createTask(scope);

      expect(await deliveries.fanOut(taskCreatedEvent(scope, taskId))).toEqual({ deliveries: 0 });
    });

    it('asks for a retry on a 5xx and gives up on a 404', async () => {
      const scope = await setupScope();
      const created = await createEndpoint(scope);
      const taskId = await createTask(scope);

      respondWith = 500;
      await deliveries.fanOut(taskCreatedEvent(scope, taskId));
      const first = await request(server())
        .get(`${deliveriesUrl(scope)}?endpointId=${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      const retrying = first.body.data.items[0].id as string;

      await expect(deliveries.deliver(retrying, 1)).rejects.toThrow('HTTP 500');
      const afterFirst = await request(server())
        .get(`${deliveriesUrl(scope)}/${retrying}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(afterFirst.body.data).toMatchObject({
        status: 'PENDING',
        attempt: 1,
        responseStatus: 500,
      });
      expect(afterFirst.body.data.nextAttemptAt).not.toBeNull();

      // The endpoint is not blamed for a delivery that is still being tried.
      const midway = await request(server())
        .get(`${hooksUrl(scope)}/${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(midway.body.data.consecutiveFailures).toEqual(0);

      respondWith = 404;
      const secondTask = await createTask(scope, 'Second');
      await deliveries.fanOut(taskCreatedEvent(scope, secondTask));
      const second = await request(server())
        .get(`${deliveriesUrl(scope)}?endpointId=${created.endpoint.id}&status=PENDING`)
        .set(auth(scope.owner))
        .expect(200);
      const doomed = (second.body.data.items as { id: string }[]).find((row) => row.id !== retrying)
        ?.id as string;

      await expect(deliveries.deliver(doomed, 1)).rejects.toThrow('HTTP 404');
      const afterFinal = await request(server())
        .get(`${deliveriesUrl(scope)}/${doomed}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(afterFinal.body.data).toMatchObject({ status: 'FAILED', responseStatus: 404 });

      const blamed = await request(server())
        .get(`${hooksUrl(scope)}/${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(blamed.body.data).toMatchObject({
        consecutiveFailures: 1,
        lastDeliveryStatus: 'FAILED',
      });
    });

    it('redelivers a settled delivery by hand, keeping its history', async () => {
      const scope = await setupScope();
      const created = await createEndpoint(scope);
      const taskId = await createTask(scope);

      respondWith = 404;
      await deliveries.fanOut(taskCreatedEvent(scope, taskId));
      const listed = await request(server())
        .get(`${deliveriesUrl(scope)}?endpointId=${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      const deliveryId = listed.body.data.items[0].id as string;
      await expect(deliveries.deliver(deliveryId, 1)).rejects.toThrow('HTTP 404');

      respondWith = 200;
      const queued = await request(server())
        .post(`${deliveriesUrl(scope)}/${deliveryId}/redeliver`)
        .set(auth(scope.owner))
        .expect(202);
      expect(queued.body.data).toMatchObject({
        id: deliveryId,
        status: 'PENDING',
        attempt: 0,
        error: null,
      });

      // Pending rows already have a job waiting on them.
      await request(server())
        .post(`${deliveriesUrl(scope)}/${deliveryId}/redeliver`)
        .set(auth(scope.owner))
        .expect(409);

      await expect(deliveries.deliver(deliveryId, 1)).resolves.toEqual({ status: 'delivered' });

      const detail = await request(server())
        .get(`${deliveriesUrl(scope)}/${deliveryId}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(detail.body.data).toMatchObject({
        status: 'SUCCEEDED',
        attempt: 1,
        responseStatus: 200,
      });
      // Both tries on the record, and the same bytes went out each time.
      expect(detail.body.data.attempts).toHaveLength(2);
      expect(received).toHaveLength(2);
      expect(received[1]!.body).toEqual(received[0]!.body);

      const forgiven = await request(server())
        .get(`${hooksUrl(scope)}/${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      expect(forgiven.body.data.consecutiveFailures).toEqual(0);
    });

    it('purges settled deliveries past retention and leaves pending ones alone', async () => {
      const scope = await setupScope();
      const created = await createEndpoint(scope);
      const taskId = await createTask(scope);

      await deliveries.fanOut(taskCreatedEvent(scope, taskId));
      const listed = await request(server())
        .get(`${deliveriesUrl(scope)}?endpointId=${created.endpoint.id}`)
        .set(auth(scope.owner))
        .expect(200);
      const settledId = listed.body.data.items[0].id as string;
      await deliveries.deliver(settledId, 1);

      // Older than the 30-day default, one settled and one still pending.
      const longAgo = new Date(Date.now() - 40 * 86_400_000);
      await context.prisma.webhookDelivery.update({
        where: { id: settledId },
        data: { createdAt: longAgo },
      });
      const pending = await context.prisma.webhookDelivery.create({
        data: {
          workspaceId: scope.workspaceId,
          endpointId: created.endpoint.id,
          eventType: 'ping',
          eventId: randomUUID(),
          url: listenerUrl,
          payload: {},
          maxAttempts: 5,
          createdAt: longAgo,
        },
        select: { id: true },
      });

      expect(await deliveries.purgeExpired()).toEqual({ deleted: 1 });
      expect(
        await context.prisma.webhookDelivery.findUnique({ where: { id: settledId } }),
      ).toBeNull();
      expect(
        await context.prisma.webhookDelivery.findUnique({ where: { id: pending.id } }),
      ).not.toBeNull();
    });

    it('publishes a comment event and fans it out with the comment and its task', async () => {
      const scope = await setupScope();
      await createEndpoint(scope, {
        name: 'comments',
        url: listenerUrl,
        events: ['comment.created'],
      });
      const taskId = await createTask(scope);

      const comment = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks/${taskId}/comments`))
        .set(auth(scope.owner))
        .send({ body: 'Heads up' })
        .expect(201);
      const commentId = comment.body.data.id as string;

      const jobs = await queue.getJobs(['waiting', 'active', 'completed', 'failed', 'delayed']);
      const job = jobs.find(
        (candidate) =>
          candidate.name === WebhookJob.FAN_OUT && candidate.data.entityId === commentId,
      );
      expect(job?.data).toMatchObject({
        trigger: AutomationTrigger.COMMENT_ADDED,
        entityType: 'COMMENT',
        after: { taskId, authorId: scope.owner.userId },
      });

      expect(await deliveries.fanOut(job!.data)).toEqual({ deliveries: 1 });
      const pending = await request(server())
        .get(deliveriesUrl(scope))
        .set(auth(scope.owner))
        .expect(200);
      await deliveries.deliver(pending.body.data.items[0].id as string, 1);

      const payload = JSON.parse((received[0] as Received).body);
      expect(payload.type).toEqual('comment.created');
      expect(payload.data.comment.id).toEqual(commentId);
      expect(payload.data.task.id).toEqual(taskId);
      expect(payload.data.ticket).toBeNull();
    });
  });
});
