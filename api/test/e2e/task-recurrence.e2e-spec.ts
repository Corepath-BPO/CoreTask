import { randomUUID } from 'node:crypto';

import { API_PREFIX } from '@coretask/contracts';
import request from 'supertest';

import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Repeating tasks: completing one creates the next — once — from the task
 * pane, from the list, and from a rule.
 */
describe('Repeating tasks (e2e)', () => {
  let context: TestContext;
  let runner: AutomationRunnerService;

  beforeAll(async () => {
    context = await createTestContext();
    runner = new AutomationRunnerService(context.prisma, {
      toProject: async () => undefined,
      toProjectAudience: async () => undefined,
      toWorkspace: async () => undefined,
    } as never);
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
    await closeTestContext(context);
  });

  const server = () => context.app.getHttpServer();
  const url = (path: string) => `${API_PREFIX}${path}`;

  const setup = async () => {
    const register = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Ada Owner', email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    const owner = {
      token: register.body.data.accessToken as string,
      userId: register.body.data.user.id as string,
    };
    const auth = { Authorization: `Bearer ${owner.token}` };

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(auth)
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(auth)
      .send({ name: 'Leasing' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const sectionId = project.body.data.sections[0].id as string;

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(auth)
      .send({ title: 'Weekly rent report', sectionId, assigneeId: owner.userId })
      .expect(201);

    return { owner, auth, workspaceId, projectId, sectionId, taskId: task.body.data.id as string };
  };

  type Scope = Awaited<ReturnType<typeof setup>>;

  const taskUrl = (scope: Scope, taskId = scope.taskId) =>
    url(`/workspaces/${scope.workspaceId}/tasks/${taskId}`);

  const repeatWeekly = (scope: Scope, dueDate: string) =>
    request(server())
      .patch(taskUrl(scope))
      .set(scope.auth)
      .send({ dueDate, recurrence: { frequency: 'WEEKLY', interval: 1, weekdays: [1] } })
      .expect(200);

  const occurrences = (scope: Scope) =>
    context.prisma.task.findMany({
      where: { workspaceId: scope.workspaceId, title: 'Weekly rent report', parentTaskId: null },
      orderBy: { createdAt: 'asc' },
    });

  it('stores the repeat, and creates the next task once when this one is completed', async () => {
    const scope = await setup();
    // A Monday far enough ahead that completing it today is early, not late.
    const updated = await repeatWeekly(scope, '2030-01-07');
    expect(updated.body.data.recurrence).toEqual({
      frequency: 'WEEKLY',
      interval: 1,
      weekdays: [1],
    });

    await request(server())
      .patch(taskUrl(scope))
      .set(scope.auth)
      .send({ status: 'DONE' })
      .expect(200);

    const [original, next] = await occurrences(scope);
    expect(next).toMatchObject({
      projectId: scope.projectId,
      sectionId: scope.sectionId,
      assigneeId: scope.owner.userId,
      completedAt: null,
      status: 'TODO',
    });
    expect(next?.dueDate?.toISOString().slice(0, 10)).toBe('2030-01-14');
    expect(next?.recurrence).toEqual({ frequency: 'WEEKLY', interval: 1, weekdays: [1] });
    expect(original?.nextOccurrenceId).toBe(next?.id);

    // Reopened and completed again: still one successor.
    await request(server())
      .patch(taskUrl(scope))
      .set(scope.auth)
      .send({ status: 'TODO' })
      .expect(200);
    await request(server())
      .patch(taskUrl(scope))
      .set(scope.auth)
      .send({ status: 'DONE' })
      .expect(200);
    expect(await occurrences(scope)).toHaveLength(2);
  });

  it('refuses a pattern it cannot follow, and stops repeating on null', async () => {
    const scope = await setup();
    await request(server())
      .patch(taskUrl(scope))
      .set(scope.auth)
      .send({ recurrence: { frequency: 'HOURLY', interval: 0 } })
      .expect(400);

    await repeatWeekly(scope, '2030-01-07');
    const cleared = await request(server())
      .patch(taskUrl(scope))
      .set(scope.auth)
      .send({ recurrence: null })
      .expect(200);
    expect(cleared.body.data.recurrence).toBeNull();

    await request(server())
      .patch(taskUrl(scope))
      .set(scope.auth)
      .send({ status: 'DONE' })
      .expect(200);
    expect(await occurrences(scope)).toHaveLength(1);
  });

  it('repeats when the task is completed from the list', async () => {
    const scope = await setup();
    await repeatWeekly(scope, '2030-01-07');
    const done = await context.prisma.statusDefinition.findFirst({
      where: { workspaceId: scope.workspaceId, category: 'COMPLETED' },
      select: { id: true },
    });

    await request(server())
      .patch(
        url(
          `/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items/${scope.taskId}`,
        ),
      )
      .set(scope.auth)
      .send({ statusId: done?.id ?? 'DONE' })
      .expect(200);

    expect(await occurrences(scope)).toHaveLength(2);
  });

  it('repeats when a rule completes the task', async () => {
    const scope = await setup();
    await repeatWeekly(scope, '2030-01-07');
    const rules = url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);
    const created = await request(server())
      .post(rules)
      .set(scope.auth)
      .send({
        name: 'Close it',
        triggerType: 'RUN_MANUALLY',
        nodes: [
          { nodeType: 'TRIGGER', subtype: 'RUN_MANUALLY', configuration: {} },
          { nodeType: 'ACTION', subtype: 'SET_COMPLETION', configuration: { completed: true } },
        ],
      })
      .expect(201);
    const ruleId = created.body.data.id as string;
    await request(server()).post(`${rules}/${ruleId}/publish`).set(scope.auth).expect(200);

    await runner.handle({
      eventId: randomUUID(),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      trigger: 'RUN_MANUALLY',
      entityType: 'TASK',
      entityId: scope.taskId,
      actorId: scope.owner.userId,
      ruleId,
      correlationId: randomUUID(),
      depth: 0,
    });

    expect(await occurrences(scope)).toHaveLength(2);
  });
});
