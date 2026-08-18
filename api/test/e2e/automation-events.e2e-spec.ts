import { API_PREFIX, AutomationTrigger } from '@coretask/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';

import { QueueName } from '../../src/jobs/queue-names';
import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

describe('Automation event delivery (e2e)', () => {
  let context: TestContext;
  let queue: Queue<AutomationEvent>;

  beforeAll(async () => {
    context = await createTestContext();
    queue = context.app.get<Queue<AutomationEvent>>(getQueueToken(QueueName.AUTOMATION));
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
    await queue.drain(true);
  });

  afterAll(async () => {
    await queue.drain(true);
    await closeTestContext(context);
  });

  it('publishes every event produced by the task and ticket APIs used by the web app', async () => {
    const register = await request(context.app.getHttpServer())
      .post(`${API_PREFIX}/auth/register`)
      .send({ name: 'Owner', email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    const token = register.body.data.accessToken as string;
    const auth = { Authorization: `Bearer ${token}` };

    const workspace = await request(context.app.getHttpServer())
      .post(`${API_PREFIX}/workspaces`)
      .set(auth)
      .send({ name: 'Automation events' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(context.app.getHttpServer())
      .post(`${API_PREFIX}/workspaces/${workspaceId}/projects`)
      .set(auth)
      .send({ name: 'Event source' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const sectionId = project.body.data.sections[0].id as string;

    const task = await request(context.app.getHttpServer())
      .post(`${API_PREFIX}/workspaces/${workspaceId}/tasks`)
      .set(auth)
      .send({ title: 'Complete me', projectId, sectionId })
      .expect(201);

    await request(context.app.getHttpServer())
      .patch(`${API_PREFIX}/workspaces/${workspaceId}/tasks/${task.body.data.id}`)
      .set(auth)
      .send({ status: 'DONE' })
      .expect(200);

    const ticket = await request(context.app.getHttpServer())
      .post(`${API_PREFIX}/workspaces/${workspaceId}/tickets`)
      .set(auth)
      .send({ title: 'Resolve me', projectId })
      .expect(201);

    await request(context.app.getHttpServer())
      .patch(`${API_PREFIX}/workspaces/${workspaceId}/tickets/${ticket.body.data.id}`)
      .set(auth)
      .send({ status: 'RESOLVED' })
      .expect(200);

    // A developer worker may be running against the same Redis database while
    // this suite uses its isolated PostgreSQL schema. Include every state so
    // the assertion is stable whether that worker has claimed the jobs or not.
    const jobs = await queue.getJobs([
      'waiting',
      'active',
      'completed',
      'failed',
      'delayed',
      'prioritized',
    ]);
    const triggers = jobs
      .filter((job) => job.data.projectId === projectId)
      .map((job) => job.data.trigger);

    expect(triggers).toEqual(
      expect.arrayContaining([
        AutomationTrigger.TASK_CREATED,
        AutomationTrigger.TASK_UPDATED,
        AutomationTrigger.TASK_STATUS_CHANGED,
        AutomationTrigger.TASK_COMPLETED,
        AutomationTrigger.TICKET_CREATED,
        AutomationTrigger.TICKET_STATUS_CHANGED,
      ]),
    );
  });
});
