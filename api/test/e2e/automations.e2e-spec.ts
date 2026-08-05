import { API_PREFIX, MAX_AUTOMATION_DEPTH, WorkspaceRole } from '@coretask/contracts';
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
 * Rule authoring through the API, and the engine driven directly.
 *
 * The runner is called in-process rather than through the queue: the worker is
 * a separate process that the e2e app does not start, and a test that depends
 * on BullMQ delivery would be measuring Redis rather than the engine. The
 * queue path itself is exercised against the running stack.
 */
describe('Automations (e2e)', () => {
  let context: TestContext;
  let runner: AutomationRunnerService;

  beforeAll(async () => {
    context = await createTestContext();
    runner = new AutomationRunnerService(context.prisma);
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterAll(async () => {
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
    member: Actor;
    workspaceId: string;
    projectId: string;
    sectionId: string;
    otherSectionId: string;
    taskId: string;
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
    const owner = await registerUser('Owner');
    const member = await registerUser('Member');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Acme Product' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Platform Foundation' })
      .expect(201);

    const sections = project.body.data.sections as { id: string }[];

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ title: 'A task', sectionId: sections[0]?.id })
      .expect(201);

    return {
      owner,
      member,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: sections[0]?.id ?? '',
      otherSectionId: sections[1]?.id ?? sections[0]?.id ?? '',
      taskId: task.body.data.id as string,
    };
  };

  const rulesUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);

  /** A published rule that assigns the owner when a task lands in a section. */
  const publishedRule = async (scope: Scope, extra: Record<string, unknown> = {}) => {
    const created = await request(server())
      .post(rulesUrl(scope))
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .send({
        name: 'Assign on arrival',
        triggerType: 'TASK_MOVED_TO_SECTION',
        triggerConfig: { sectionId: scope.sectionId },
        nodes: [
          { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', configuration: {} },
          {
            nodeType: 'ACTION',
            subtype: 'ASSIGN_USER',
            configuration: { userId: scope.owner.userId },
          },
        ],
        ...extra,
      })
      .expect(201);

    await request(server())
      .post(`${rulesUrl(scope)}/${created.body.data.id}/publish`)
      .set('Authorization', `Bearer ${scope.owner.token}`)
      .expect(200);

    return created.body.data.id as string;
  };

  const moveEvent = (scope: Scope, overrides: Record<string, unknown> = {}) => ({
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    trigger: 'TASK_MOVED_TO_SECTION' as const,
    entityType: 'TASK' as const,
    entityId: scope.taskId,
    actorId: scope.owner.userId,
    after: { sectionId: scope.sectionId },
    correlationId: '019fc8d5-0000-7000-8000-000000000001',
    depth: 0,
    ...overrides,
  });

  // -------------------------------------------------------------------------
  describe('authoring', () => {
    it('creates a rule as a draft', async () => {
      const scope = await setupScope();

      const response = await request(server())
        .post(rulesUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Probe', triggerType: 'TASK_CREATED' })
        .expect(201);

      expect(response.body.data.status).toBe('DRAFT');
      expect(response.body.data.publishedAt).toBeNull();
    });

    /*
     * Stronger than the service defaulting to DRAFT: `status` is not an
     * accepted input at all, so there is no request that could ask for a rule
     * to start live. Publishing is the only way, and it validates.
     */
    it('does not accept a status on create', async () => {
      const scope = await setupScope();

      await request(server())
        .post(rulesUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Probe', triggerType: 'TASK_CREATED', status: 'ACTIVE' })
        .expect(422);
    });

    /*
     * Each of these fails silently at run time otherwise — a rule with no
     * action does nothing, and one naming a deleted section never matches.
     */
    it('refuses to publish a rule with no action', async () => {
      const scope = await setupScope();

      const created = await request(server())
        .post(rulesUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Empty', triggerType: 'TASK_CREATED' })
        .expect(201);

      const response = await request(server())
        .post(`${rulesUrl(scope)}/${created.body.data.id}/publish`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);

      expect(response.body.error.details.problems.join(' ')).toMatch(/at least one action/i);
    });

    it('refuses to publish an action the engine cannot run', async () => {
      const scope = await setupScope();

      const created = await request(server())
        .post(rulesUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          name: 'Future',
          triggerType: 'TASK_CREATED',
          nodes: [{ nodeType: 'ACTION', subtype: 'SEND_EMAIL', configuration: {} }],
        })
        .expect(201);

      await request(server())
        .post(`${rulesUrl(scope)}/${created.body.data.id}/publish`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(400);
    });

    it('publishes a valid rule', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      const rule = await request(server())
        .get(`${rulesUrl(scope)}/${ruleId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(rule.body.data.status).toBe('ACTIVE');
      expect(rule.body.data.publishedAt).not.toBeNull();
    });

    it('lists only the rules watching a given section', async () => {
      const scope = await setupScope();
      await publishedRule(scope);

      const matching = await request(server())
        .get(`${rulesUrl(scope)}?sectionId=${scope.sectionId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);
      const other = await request(server())
        .get(`${rulesUrl(scope)}?sectionId=${scope.otherSectionId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(matching.body.data).toHaveLength(1);
      expect(other.body.data).toHaveLength(0);
    });

    it('refuses a member without the manager role', async () => {
      const scope = await setupScope();

      await request(server())
        .post(rulesUrl(scope))
        .set('Authorization', `Bearer ${scope.member.token}`)
        .send({ name: 'Sneaky', triggerType: 'TASK_CREATED' })
        .expect(403);
    });

    it('does not reach across workspaces', async () => {
      const scope = await setupScope();
      const other = await setupScope();
      const theirs = await publishedRule(other);

      await request(server())
        .get(`${rulesUrl(scope)}/${theirs}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(404);
    });

    it('archives a rule that has run, deletes a draft', async () => {
      const scope = await setupScope();

      const draft = await request(server())
        .post(rulesUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Never ran', triggerType: 'TASK_CREATED' })
        .expect(201);

      const deleted = await request(server())
        .delete(`${rulesUrl(scope)}/${draft.body.data.id}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(deleted.body.data).toEqual({ deleted: true, archived: false });

      const published = await publishedRule(scope);
      const archived = await request(server())
        .delete(`${rulesUrl(scope)}/${published}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      expect(archived.body.data).toEqual({ deleted: false, archived: true });
    });
  });

  // -------------------------------------------------------------------------
  describe('execution', () => {
    it('runs a matching rule and performs its action', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      const result = await runner.handle(moveEvent(scope));

      expect(result.executed).toBe(1);

      const task = await context.prisma.task.findUniqueOrThrow({ where: { id: scope.taskId } });
      expect(task.assigneeId).toBe(scope.owner.userId);

      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId },
      });
      expect(execution.status).toBe('COMPLETED');
    });

    it('writes a log for every action attempted', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      await runner.handle(moveEvent(scope));

      const logs = await context.prisma.automationExecutionLog.findMany({
        where: { execution: { ruleId } },
      });

      expect(logs).toHaveLength(1);
      expect(logs[0]?.succeeded).toBe(true);
      expect(logs[0]?.subtype).toBe('ASSIGN_USER');
    });

    it('names the rule in the activity feed', async () => {
      const scope = await setupScope();
      await publishedRule(scope);

      await runner.handle(moveEvent(scope));

      const activity = await context.prisma.activityLog.findFirst({
        where: { entityId: scope.taskId, summary: { contains: 'Automation' } },
      });

      expect(activity?.summary).toContain('Assign on arrival');
    });

    it('does not run when the trigger names a different section', async () => {
      const scope = await setupScope();
      await publishedRule(scope);

      const result = await runner.handle(
        moveEvent(scope, { after: { sectionId: scope.otherSectionId } }),
      );

      expect(result.executed).toBe(0);
    });

    /*
     * A rule whose conditions do not hold has not failed; it does not apply.
     * The history has to distinguish the two.
     */
    it('skips with a reason when a condition does not hold', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope, {
        nodes: [
          { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', configuration: {} },
          {
            nodeType: 'CONDITION',
            subtype: 'priority',
            configuration: { field: 'priority', operator: 'EQUALS', value: 'CRITICAL' },
          },
          {
            nodeType: 'ACTION',
            subtype: 'ASSIGN_USER',
            configuration: { userId: scope.owner.userId },
          },
        ],
      });

      await runner.handle(moveEvent(scope));

      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId },
      });
      expect(execution.status).toBe('SKIPPED');
      expect(execution.skippedReason).toMatch(/condition not met/i);

      const task = await context.prisma.task.findUniqueOrThrow({ where: { id: scope.taskId } });
      expect(task.assigneeId).toBeNull();
    });

    it('does not run a paused rule', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/pause`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      const result = await runner.handle(moveEvent(scope));

      expect(result.executed).toBe(0);
    });

    it('fails an action loudly rather than reporting a false success', async () => {
      const scope = await setupScope();
      const stranger = await registerUser('Stranger');

      // Published with a valid member, then the target is swapped for someone
      // outside the workspace — which is what happens when a person leaves.
      const ruleId = await publishedRule(scope);
      await context.prisma.automationNode.updateMany({
        where: { ruleId, subtype: 'ASSIGN_USER' },
        data: { configuration: { userId: stranger.userId } },
      });

      await runner.handle(moveEvent(scope));

      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId },
      });
      expect(execution.status).toBe('FAILED');

      const log = await context.prisma.automationExecutionLog.findFirstOrThrow({
        where: { execution: { ruleId } },
      });
      expect(log.succeeded).toBe(false);
      expect(log.message).toMatch(/no longer in this workspace/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('loop protection', () => {
    it('stops a chain at the depth limit and says why', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      const result = await runner.handle(moveEvent(scope, { depth: MAX_AUTOMATION_DEPTH }));

      expect(result.executed).toBe(0);

      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId },
      });
      expect(execution.status).toBe('SKIPPED');
      expect(execution.skippedReason).toMatch(/depth limit/i);
    });

    /* The commonest loop: a rule reacting to its own write. */
    it('never lets a rule react to a change it made', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);

      const result = await runner.handle(moveEvent(scope, { causedByRuleId: ruleId }));

      expect(result.executed).toBe(0);
      expect(await context.prisma.automationExecution.count({ where: { ruleId } })).toBe(0);
    });

    it('carries one correlation id across a chain', async () => {
      const scope = await setupScope();
      const ruleId = await publishedRule(scope);
      const correlationId = '019fc8d5-0000-7000-8000-00000000abcd';

      await runner.handle(moveEvent(scope, { correlationId }));

      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId },
      });
      expect(execution.correlationId).toBe(correlationId);
    });
  });
});
