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
 * Milestones and approvals: added from the project, converted from the pane,
 * decided, and seen by rules.
 */
describe('Milestones and approvals (e2e)', () => {
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
      .send({ name: 'Launch' })
      .expect(201);
    return {
      owner,
      auth,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: project.body.data.sections[0].id as string,
    };
  };

  type Scope = Awaited<ReturnType<typeof setup>>;
  const taskUrl = (scope: Scope, taskId: string) =>
    url(`/workspaces/${scope.workspaceId}/tasks/${taskId}`);

  const add = async (scope: Scope, type: string, title: string) =>
    (
      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/work-items`))
        .set(scope.auth)
        .send({ type, title, sectionId: scope.sectionId })
        .expect(201)
    ).body.data as { id: string; type: string; details: Record<string, unknown> };

  it('adds a milestone and an approval from the project, as tasks of that kind', async () => {
    const scope = await setup();

    const milestone = await add(scope, 'MILESTONE', 'Beta ships');
    expect(milestone.type).toBe('TASK');
    expect(milestone.details).toMatchObject({ taskKind: 'MILESTONE', approvalStatus: null });

    const approval = await add(scope, 'APPROVAL', 'Sign off the copy');
    expect(approval.details).toMatchObject({ taskKind: 'APPROVAL', approvalStatus: 'PENDING' });

    const fetched = await request(server())
      .get(taskUrl(scope, approval.id))
      .set(scope.auth)
      .expect(200);
    expect(fetched.body.data).toMatchObject({ kind: 'APPROVAL', approvalStatus: 'PENDING' });
  });

  it('completes an approval when it is decided, and reopens it for changes', async () => {
    const scope = await setup();
    const approval = await add(scope, 'APPROVAL', 'Sign off the copy');

    const approved = await request(server())
      .patch(taskUrl(scope, approval.id))
      .set(scope.auth)
      .send({ approvalStatus: 'APPROVED' })
      .expect(200);
    expect(approved.body.data).toMatchObject({ approvalStatus: 'APPROVED', status: 'DONE' });
    expect(approved.body.data.completedAt).not.toBeNull();

    const sentBack = await request(server())
      .patch(taskUrl(scope, approval.id))
      .set(scope.auth)
      .send({ approvalStatus: 'CHANGES_REQUESTED' })
      .expect(200);
    expect(sentBack.body.data).toMatchObject({
      approvalStatus: 'CHANGES_REQUESTED',
      completedAt: null,
    });
  });

  it('converts between kinds, and refuses a decision on anything but an approval', async () => {
    const scope = await setup();
    const task = await add(scope, 'TASK', 'Plain task');

    await request(server())
      .patch(taskUrl(scope, task.id))
      .set(scope.auth)
      .send({ approvalStatus: 'APPROVED' })
      .expect(400);

    const converted = await request(server())
      .patch(taskUrl(scope, task.id))
      .set(scope.auth)
      .send({ kind: 'APPROVAL' })
      .expect(200);
    expect(converted.body.data).toMatchObject({ kind: 'APPROVAL', approvalStatus: 'PENDING' });

    const back = await request(server())
      .patch(taskUrl(scope, task.id))
      .set(scope.auth)
      .send({ kind: 'MILESTONE' })
      .expect(200);
    expect(back.body.data).toMatchObject({ kind: 'MILESTONE', approvalStatus: null });
  });

  it('lets a rule check the type and convert a task', async () => {
    const scope = await setup();
    const task = await add(scope, 'TASK', 'Review the contract');
    const rules = url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);

    const created = await request(server())
      .post(rules)
      .set(scope.auth)
      .send({
        name: 'Make it an approval',
        triggerType: 'RUN_MANUALLY',
        nodes: [
          { nodeType: 'TRIGGER', subtype: 'RUN_MANUALLY', configuration: {} },
          {
            nodeType: 'CONDITION',
            subtype: 'TASK_TYPE',
            configuration: { field: 'TASK_TYPE', operator: 'IS', value: 'TASK' },
          },
          { nodeType: 'ACTION', subtype: 'SET_TASK_TYPE', configuration: { kind: 'APPROVAL' } },
        ],
      })
      .expect(201);
    const ruleId = created.body.data.id as string;
    await request(server()).post(`${rules}/${ruleId}/publish`).set(scope.auth).expect(200);

    const event = () => ({
      eventId: randomUUID(),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      trigger: 'RUN_MANUALLY' as const,
      entityType: 'TASK' as const,
      entityId: task.id,
      actorId: scope.owner.userId,
      ruleId,
      correlationId: randomUUID(),
      depth: 0,
    });

    const first = await runner.handle(event());
    expect(first.executed).toBe(1);
    expect(first.events.map((next) => next.trigger)).toContain('TASK_TYPE_CHANGED');
    expect(await context.prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      kind: 'APPROVAL',
      approvalStatus: 'PENDING',
    });

    // Now an approval, it no longer matches "type is task".
    expect((await runner.handle(event())).executed).toBe(0);
  });
});
