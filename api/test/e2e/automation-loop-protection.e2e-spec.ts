import { randomUUID } from 'node:crypto';

import { API_PREFIX, MAX_ACTIONS_PER_CHAIN, MAX_ACTIONS_PER_EXECUTION } from '@coretask/contracts';
import request from 'supertest';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * The guards that stop rules repeating or running away, beyond depth and
 * self-retrigger (which the main automations suite covers): a queue retry
 * finding the runs it already made, the per-run action cap logging what it
 * cut, and the cap on what one chain of rules may do between them.
 *
 * The runner is driven in-process, as in the main suite — a retry is the same
 * event handed to `handle` twice, which is exactly what BullMQ does.
 */
describe('Automation loop protection (e2e)', () => {
  let context: TestContext;
  let runner: AutomationRunnerService;

  beforeAll(async () => {
    context = await createTestContext();
    runner = new AutomationRunnerService(context.prisma, {
      toProject: async () => undefined,
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

  interface Scope {
    token: string;
    userId: string;
    workspaceId: string;
    projectId: string;
    sectionId: string;
    otherSectionId: string;
    taskId: string;
  }

  const setupScope = async (): Promise<Scope> => {
    const registered = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Owner', email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    const token = registered.body.data.accessToken as string;

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Loop Works' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Intake' })
      .expect(201);
    const sections = project.body.data.sections as { id: string }[];

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'A task', sectionId: sections[0]?.id })
      .expect(201);

    return {
      token,
      userId: registered.body.data.user.id as string,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: sections[0]?.id ?? '',
      otherSectionId: sections[1]?.id ?? '',
      taskId: task.body.data.id as string,
    };
  };

  const rulesUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);

  /** A chain of actions under the trigger, each after the last. */
  const chainOf = (actions: { subtype: string; configuration: Record<string, unknown> }[]) => [
    { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', parentId: null, order: 0 },
    ...actions.map((action, index) => ({
      id: `a${index}`,
      nodeType: 'ACTION',
      subtype: action.subtype,
      configuration: action.configuration,
      parentId: index === 0 ? 't' : `a${index - 1}`,
      order: index + 1,
    })),
  ];

  const comments = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      subtype: 'ADD_COMMENT',
      configuration: { body: `Note ${index + 1}` },
    }));

  /** Creates the rule and returns its id; `publish` false leaves it a draft. */
  const createRule = async (
    scope: Scope,
    actions: { subtype: string; configuration: Record<string, unknown> }[],
    publish = true,
  ) => {
    const created = await request(server())
      .post(rulesUrl(scope))
      .set('Authorization', `Bearer ${scope.token}`)
      .send({
        name: 'Busy rule',
        triggerType: 'TASK_MOVED_TO_SECTION',
        triggerConfig: {},
        nodes: chainOf(actions),
      })
      .expect(201);
    const ruleId = created.body.data.id as string;

    if (publish) {
      await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/publish`)
        .set('Authorization', `Bearer ${scope.token}`)
        .expect(200);
    }

    return ruleId;
  };

  const moveEvent = (scope: Scope, overrides: Partial<AutomationEvent> = {}): AutomationEvent => ({
    eventId: randomUUID(),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    trigger: 'TASK_MOVED_TO_SECTION',
    entityType: 'TASK',
    entityId: scope.taskId,
    actorId: scope.userId,
    after: { sectionId: scope.sectionId },
    correlationId: randomUUID(),
    depth: 0,
    ...overrides,
  });

  const commentCount = (scope: Scope) =>
    context.prisma.comment.count({ where: { taskId: scope.taskId, deletedAt: null } });

  /** Work some other run in the chain already did, as the cap counts it. */
  const spend = async (scope: Scope, ruleId: string, chainId: string, actions: number) => {
    await context.prisma.automationExecution.create({
      data: {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        ruleId,
        status: 'COMPLETED',
        triggerType: 'TASK_MOVED_TO_SECTION',
        correlationId: randomUUID(),
        chainId,
        actionsRun: actions,
        finishedAt: new Date(),
      },
    });
  };

  // -------------------------------------------------------------------------
  describe('a retried job', () => {
    it('finds the run it already made and does not make the changes again', async () => {
      const scope = await setupScope();
      await createRule(scope, [
        { subtype: 'ADD_COMMENT', configuration: { body: 'Picked up' } },
        { subtype: 'MOVE_TO_SECTION', configuration: { sectionId: scope.otherSectionId } },
      ]);
      const event = moveEvent(scope);

      const first = await runner.handle(event);
      const second = await runner.handle(event);

      expect(await commentCount(scope)).toBe(1);
      expect(await context.prisma.automationExecution.count()).toBe(1);

      /*
       * The retry still hands back what the first run raised — the move — so
       * a job that failed after this rule ran does not lose the chain. Same
       * event ids, so the queue sees the repeat for what it is.
       */
      expect(first.events).toHaveLength(1);
      expect(second.events.map((next) => next.eventId)).toEqual(
        first.events.map((next) => next.eventId),
      );
      expect(second.executed).toBe(0);
    });

    it('closes a run that stopped part-way instead of repeating its steps', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, [
        { subtype: 'ADD_COMMENT', configuration: { body: 'Picked up' } },
      ]);
      const event = moveEvent(scope);
      const raised = { ...moveEvent(scope), eventId: randomUUID(), depth: 1 };

      // What a worker dying mid-run leaves: RUNNING, one step logged.
      const interrupted = await context.prisma.automationExecution.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          ruleId,
          status: 'RUNNING',
          triggerType: 'TASK_MOVED_TO_SECTION',
          correlationId: event.correlationId,
          chainId: event.eventId,
          idempotencyKey: event.eventId,
          logs: {
            create: {
              nodeType: 'ACTION',
              subtype: 'MOVE_TO_SECTION',
              succeeded: true,
              followUps: { events: [raised] } as never,
            },
          },
        },
      });

      const result = await runner.handle(event);

      expect(await commentCount(scope)).toBe(0);
      const closed = await context.prisma.automationExecution.findUniqueOrThrow({
        where: { id: interrupted.id },
      });
      expect(closed.status).toBe('FAILED');
      expect(closed.error).toMatch(/stopped part-way/);
      // What the step that did finish raised still goes out.
      expect(result.events.map((next) => next.eventId)).toEqual([raised.eventId]);
    });

    it('runs a rule again for a new event — the key is the event, not the task', async () => {
      const scope = await setupScope();
      await createRule(scope, [{ subtype: 'ADD_COMMENT', configuration: { body: 'Again' } }]);

      await runner.handle(moveEvent(scope));
      await runner.handle(moveEvent(scope));

      expect(await commentCount(scope)).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('the per-run cap', () => {
    it('refuses to publish a rule with more actions in a row than one run performs', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, comments(MAX_ACTIONS_PER_EXECUTION + 1), false);

      const response = await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/publish`)
        .set('Authorization', `Bearer ${scope.token}`)
        .expect(400);

      expect(response.body.error.details.problems).toContainEqual(
        expect.stringContaining(`at most ${MAX_ACTIONS_PER_EXECUTION} actions in one run`),
      );
    });

    it('logs every step past it as not run, and does not call the run complete', async () => {
      const scope = await setupScope();
      // Written before the check existed, as far as the runner can tell.
      const ruleId = await createRule(scope, comments(MAX_ACTIONS_PER_EXECUTION + 2), false);
      await context.prisma.automationRule.update({
        where: { id: ruleId },
        data: { status: 'ACTIVE' },
      });

      await runner.handle(moveEvent(scope));

      expect(await commentCount(scope)).toBe(MAX_ACTIONS_PER_EXECUTION);

      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId },
        include: { logs: { orderBy: { createdAt: 'asc' } } },
      });
      expect(execution.status).toBe('PARTIALLY_FAILED');
      expect(execution.actionsRun).toBe(MAX_ACTIONS_PER_EXECUTION);
      expect(execution.error).toBe(
        `2 steps were not run: a rule does at most ${MAX_ACTIONS_PER_EXECUTION} actions in one run.`,
      );

      const notRun = execution.logs.filter((log) => log.message?.startsWith('Not run'));
      expect(notRun).toHaveLength(2);
      expect(notRun.every((log) => !log.succeeded && log.subtype === 'ADD_COMMENT')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('the chain cap', () => {
    it('lets a run do only what is left of the chain’s allowance', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, comments(5));
      const chainId = randomUUID();
      await spend(scope, ruleId, chainId, MAX_ACTIONS_PER_CHAIN - 2);

      await runner.handle(moveEvent(scope, { chainId, depth: 1 }));

      expect(await commentCount(scope)).toBe(2);
      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId, idempotencyKey: { not: null } },
        include: { logs: true },
      });
      expect(execution.status).toBe('PARTIALLY_FAILED');
      expect(execution.chainId).toBe(chainId);
      expect(execution.logs.filter((log) => log.message?.startsWith('Not run'))).toHaveLength(3);
      expect(execution.error).toMatch(/3 steps were not run: the rules this change set off/);
    });

    it('skips a run with nothing left, saying it looks like a loop', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, comments(3));
      const chainId = randomUUID();
      await spend(scope, ruleId, chainId, MAX_ACTIONS_PER_CHAIN);

      const result = await runner.handle(moveEvent(scope, { chainId, depth: 2 }));

      expect(result.executed).toBe(0);
      expect(await commentCount(scope)).toBe(0);
      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId, idempotencyKey: { not: null } },
      });
      expect(execution.status).toBe('SKIPPED');
      expect(execution.skippedReason).toMatch(/^Stopped: .*This looks like a loop\.$/);
    });

    it('counts a chain, not a batch that shares a correlation id', async () => {
      /*
       * A manual or scheduled run gives every task in the batch the same
       * correlation id. Fifty tasks are fifty chains; counting by correlation
       * would cut the fiftieth task off for the work done on the other
       * forty-nine.
       */
      const scope = await setupScope();
      const ruleId = await createRule(scope, comments(3));
      const correlationId = randomUUID();
      await spend(scope, ruleId, randomUUID(), MAX_ACTIONS_PER_CHAIN);

      await runner.handle(moveEvent(scope, { correlationId }));

      expect(await commentCount(scope)).toBe(3);
    });

    it('carries the chain to every event a run raises', async () => {
      const scope = await setupScope();
      await createRule(scope, [
        { subtype: 'MOVE_TO_SECTION', configuration: { sectionId: scope.otherSectionId } },
      ]);
      const event = moveEvent(scope, { chainId: randomUUID() });

      const result = await runner.handle(event);

      expect(result.events).toEqual([
        expect.objectContaining({ chainId: event.chainId, depth: 1 }),
      ]);
    });
  });
});
