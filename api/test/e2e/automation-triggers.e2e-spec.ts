import { randomUUID } from 'node:crypto';

import { API_PREFIX, nextOccurrence, readSchedule, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationClockService } from '../../src/modules/automations/automation-clock.service';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * The triggers that are not edits — run by hand, on a schedule, by a date —
 * and the actions and checks added beside them.
 *
 * The runner and the clock are driven in-process, as the other automation
 * suites drive the runner: the worker is a separate process, and a test that
 * waited on BullMQ would be measuring Redis. The clock is handed a publisher
 * that records instead of enqueuing, so each test sees exactly what came due.
 */
describe('Automation triggers and actions (e2e)', () => {
  let context: TestContext;
  let runner: AutomationRunnerService;
  let clock: AutomationClockService;
  let published: AutomationEvent[];

  beforeAll(async () => {
    context = await createTestContext();
    runner = new AutomationRunnerService(context.prisma, {
      toProject: async () => undefined,
      toWorkspace: async () => undefined,
    } as never);
    clock = new AutomationClockService(context.prisma, {
      publish: async (
        event: Omit<AutomationEvent, 'eventId' | 'correlationId' | 'depth'> &
          Partial<AutomationEvent>,
      ) => {
        published.push({
          ...event,
          eventId: event.eventId ?? randomUUID(),
          correlationId: event.correlationId ?? randomUUID(),
          depth: event.depth ?? 0,
        });
      },
    } as never);
  });

  beforeEach(async () => {
    published = [];
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
    guest: Actor;
    workspaceId: string;
    projectId: string;
    sectionId: string;
    otherSectionId: string;
    taskId: string;
  }

  const registerUser = async (name: string): Promise<Actor> => {
    const response = await request(server())
      .post(url('/auth/register'))
      .send({ name, email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    return {
      token: response.body.data.accessToken as string,
      userId: response.body.data.user.id as string,
    };
  };

  const as = (actor: Actor) => ({ Authorization: `Bearer ${actor.token}` });

  const setupScope = async (): Promise<Scope> => {
    const owner = await registerUser('Ada Owner');
    const member = await registerUser('Bea Member');
    const guest = await registerUser('Cy Guest');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
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
      .set(as(owner))
      .send({ name: 'Leasing' })
      .expect(201);
    const sections = project.body.data.sections as { id: string }[];

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(as(owner))
      .send({ title: 'Renew lease', sectionId: sections[0]?.id })
      .expect(201);

    return {
      owner,
      member,
      guest,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: sections[0]?.id ?? '',
      otherSectionId: sections[1]?.id ?? '',
      taskId: task.body.data.id as string,
    };
  };

  const rulesUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);

  interface NodeInput {
    nodeType: string;
    subtype: string;
    configuration?: Record<string, unknown>;
  }

  /** A rule with a trigger and steps, saved and (by default) published. */
  const rule = async (
    scope: Scope,
    trigger: string,
    triggerConfig: Record<string, unknown>,
    steps: NodeInput[],
    { publish = true, name = 'A rule' } = {},
  ) => {
    const created = await request(server())
      .post(rulesUrl(scope))
      .set(as(scope.owner))
      .send({
        name,
        triggerType: trigger,
        triggerConfig,
        nodes: [{ nodeType: 'TRIGGER', subtype: trigger, configuration: triggerConfig }, ...steps],
      })
      .expect(201);
    const id = created.body.data.id as string;

    if (publish) {
      await request(server())
        .post(`${rulesUrl(scope)}/${id}/publish`)
        .set(as(scope.owner))
        .expect(200);
    }
    return id;
  };

  const action = (subtype: string, configuration: Record<string, unknown> = {}): NodeInput => ({
    nodeType: 'ACTION',
    subtype,
    configuration,
  });

  const event = (scope: Scope, overrides: Partial<AutomationEvent>): AutomationEvent => ({
    eventId: randomUUID(),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    trigger: 'RUN_MANUALLY',
    entityType: 'TASK',
    entityId: scope.taskId,
    actorId: scope.owner.userId,
    correlationId: randomUUID(),
    depth: 0,
    ...overrides,
  });

  const task = (id: string) => context.prisma.task.findUniqueOrThrow({ where: { id } });

  describe('the Wait step', () => {
    const DAY_MS = 86_400_000;

    /** Waits two days after assigning, then comments if the task is still open. */
    const waitingRule = async (scope: Scope) => {
      const created = await request(server())
        .post(rulesUrl(scope))
        .set(as(scope.owner))
        .send({
          name: 'Chase in two days',
          triggerType: 'TASK_MOVED_TO_SECTION',
          triggerConfig: { sectionId: scope.otherSectionId },
          nodes: [
            {
              id: 't',
              nodeType: 'TRIGGER',
              subtype: 'TASK_MOVED_TO_SECTION',
              parentId: null,
              configuration: { sectionId: scope.otherSectionId },
            },
            {
              id: 'a1',
              nodeType: 'ACTION',
              subtype: 'ASSIGN_USER',
              parentId: 't',
              configuration: { userId: scope.member.userId },
            },
            {
              id: 'd',
              nodeType: 'DELAY',
              subtype: 'DELAY',
              parentId: 'a1',
              configuration: { amount: 2, unit: 'DAYS' },
            },
            {
              id: 'c',
              nodeType: 'CONDITION',
              subtype: 'FIELD_COMPARISON',
              parentId: 'd',
              configuration: { field: 'completed', operator: 'IS_NOT_CHECKED' },
            },
            {
              id: 'a2',
              nodeType: 'ACTION',
              subtype: 'ADD_COMMENT',
              parentId: 'c',
              configuration: { body: 'Still open after two days' },
            },
          ],
        })
        .expect(201);
      const id = created.body.data.id as string;
      await request(server())
        .post(`${rulesUrl(scope)}/${id}/publish`)
        .set(as(scope.owner))
        .expect(200);
      const wait = await context.prisma.automationNode.findFirstOrThrow({
        where: { ruleId: id, nodeType: 'DELAY' },
      });
      return { id, waitId: wait.id };
    };

    const moved = (scope: Scope) =>
      event(scope, {
        trigger: 'TASK_MOVED_TO_SECTION',
        after: { sectionId: scope.otherSectionId },
      });
    const comments = (scope: Scope) =>
      context.prisma.comment.count({ where: { taskId: scope.taskId } });

    it('does what comes before at once, and what follows once the clock says so', async () => {
      const scope = await setupScope();
      const { id, waitId } = await waitingRule(scope);
      const started = Date.now();

      expect((await runner.handle(moved(scope))).executed).toBe(1);
      expect((await task(scope.taskId)).assigneeId).toBe(scope.member.userId);
      expect(await comments(scope)).toBe(0);
      const waiting = await context.prisma.automationDelayedRun.findFirstOrThrow({
        where: { ruleId: id },
      });
      expect(waiting).toMatchObject({ nodeId: waitId, status: 'PENDING' });
      expect(waiting.runAt.getTime() - started).toBeGreaterThanOrEqual(2 * DAY_MS - 60_000);

      // A day in: not yet.
      await clock.tick(new Date(started + DAY_MS));
      expect(published).toEqual([]);

      // Two days in: the run is published again, aimed at the rule, after the wait.
      await clock.tick(new Date(started + 2 * DAY_MS + 60_000));
      expect(published).toEqual([
        expect.objectContaining({
          ruleId: id,
          resumeFromNodeId: waitId,
          trigger: 'TASK_MOVED_TO_SECTION',
          entityId: scope.taskId,
        }),
      ]);
      expect(
        (await context.prisma.automationDelayedRun.findUniqueOrThrow({ where: { id: waiting.id } }))
          .status,
      ).toBe('DONE');

      // Picked up after the wait: still open, so the comment goes on; the
      // assignment before the wait is not done again.
      await context.prisma.task.update({
        where: { id: scope.taskId },
        data: { assigneeId: scope.owner.userId },
      });
      expect((await runner.handle(published[0]!)).executed).toBe(1);
      expect(await comments(scope)).toBe(1);
      expect((await task(scope.taskId)).assigneeId).toBe(scope.owner.userId);

      // And a second tick finds nothing left to resume.
      published = [];
      await clock.tick(new Date(started + 3 * DAY_MS));
      expect(published).toEqual([]);
    });

    it('judges what follows the wait on the task as it is by then', async () => {
      const scope = await setupScope();
      await waitingRule(scope);
      const started = Date.now();
      await runner.handle(moved(scope));

      // Finished in the meantime: the condition after the wait no longer holds.
      await context.prisma.task.update({
        where: { id: scope.taskId },
        data: { completedAt: new Date() },
      });
      await clock.tick(new Date(started + 2 * DAY_MS + 60_000));
      expect(published).toHaveLength(1);
      await runner.handle(published[0]!);
      expect(await comments(scope)).toBe(0);
    });

    it('cancels a waiting run when the rule has stopped by then', async () => {
      const scope = await setupScope();
      const { id } = await waitingRule(scope);
      const started = Date.now();
      await runner.handle(moved(scope));

      await context.prisma.automationRule.update({
        where: { id },
        data: { status: 'PAUSED' },
      });
      await clock.tick(new Date(started + 2 * DAY_MS + 60_000));
      expect(published).toEqual([]);
      expect(
        (await context.prisma.automationDelayedRun.findFirstOrThrow({ where: { ruleId: id } }))
          .status,
      ).toBe('CANCELLED');
    });

    it('waits in a rule without paths too: in order, up to the wait', async () => {
      const scope = await setupScope();
      const id = await rule(scope, 'RUN_MANUALLY', { label: 'Later' }, [
        action('ASSIGN_USER', { userId: scope.member.userId }),
        { nodeType: 'DELAY', subtype: 'DELAY', configuration: { amount: 3, unit: 'HOURS' } },
        action('ADD_COMMENT', { body: 'Three hours on' }),
      ]);
      const started = Date.now();

      await runner.handle(event(scope, { ruleId: id }));
      expect((await task(scope.taskId)).assigneeId).toBe(scope.member.userId);
      expect(await comments(scope)).toBe(0);

      await clock.tick(new Date(started + 3 * 3_600_000 + 60_000));
      expect(published).toHaveLength(1);
      await runner.handle(published[0]!);
      expect(await comments(scope)).toBe(1);
    });

    it('refuses a wait with no length, or longer than 90 days', async () => {
      const scope = await setupScope();
      const save = (configuration: Record<string, unknown>) =>
        rule(
          scope,
          'RUN_MANUALLY',
          { label: 'Bad wait' },
          [
            { nodeType: 'DELAY', subtype: 'DELAY', configuration },
            action('ADD_COMMENT', { body: 'Then' }),
          ],
          { publish: false },
        );
      for (const configuration of [{}, { amount: 91, unit: 'DAYS' }]) {
        const id = await save(configuration);
        await request(server())
          .post(`${rulesUrl(scope)}/${id}/publish`)
          .set(as(scope.owner))
          .expect(400);
      }
    });
  });

  describe('run manually', () => {
    it('runs the one rule it names, with variables filled in', async () => {
      const scope = await setupScope();
      const chosen = await rule(scope, 'RUN_MANUALLY', { label: 'Chase tenant' }, [
        action('SET_TASK_NAME', { text: 'Chase: {{task.name}} ({{triggered_by}})' }),
      ]);
      await rule(scope, 'RUN_MANUALLY', {}, [action('SET_TASK_NAME', { text: 'The other rule' })]);

      const result = await runner.handle(event(scope, { ruleId: chosen }));

      expect(result.executed).toBe(1);
      expect((await task(scope.taskId)).title).toBe('Chase: Renew lease (Ada Owner)');
    });

    it('queues a run for anyone who can edit, and refuses guests and drafts', async () => {
      const scope = await setupScope();
      const live = await rule(scope, 'RUN_MANUALLY', {}, [action('SET_COMPLETION')]);
      const draft = await rule(scope, 'RUN_MANUALLY', {}, [action('SET_COMPLETION')], {
        publish: false,
      });

      const queued = await request(server())
        .post(`${rulesUrl(scope)}/${live}/run`)
        .set(as(scope.member))
        .send({ taskIds: [scope.taskId] })
        .expect(202);
      expect(queued.body.data).toEqual({ queued: 1 });

      await request(server())
        .post(`${rulesUrl(scope)}/${live}/run`)
        .set(as(scope.guest))
        .send({ taskIds: [scope.taskId] })
        .expect(403);
      await request(server())
        .post(`${rulesUrl(scope)}/${draft}/run`)
        .set(as(scope.member))
        .send({ taskIds: [scope.taskId] })
        .expect(400);
      await request(server())
        .post(`${rulesUrl(scope)}/${live}/run`)
        .set(as(scope.member))
        .send({ taskIds: [randomUUID()] })
        .expect(404);
    });
  });

  describe('new actions', () => {
    it('completes a task through the project’s Done status, and reopens it', async () => {
      const scope = await setupScope();
      const complete = await rule(scope, 'RUN_MANUALLY', {}, [
        action('SET_COMPLETION', { completed: true }),
      ]);
      const reopen = await rule(scope, 'RUN_MANUALLY', {}, [
        action('SET_COMPLETION', { completed: false }),
      ]);

      const done = await runner.handle(event(scope, { ruleId: complete }));
      expect((await task(scope.taskId)).completedAt).not.toBeNull();
      // Finishing it is an event the next rule can hear.
      expect(done.events.map((next) => next.trigger)).toContain('TASK_COMPLETED');

      await runner.handle(event(scope, { ruleId: reopen }));
      expect((await task(scope.taskId)).completedAt).toBeNull();
    });

    it('creates a task beside this one, named with variables, in the chosen section', async () => {
      const scope = await setupScope();
      const id = await rule(scope, 'RUN_MANUALLY', {}, [
        action('CREATE_TASK', {
          title: 'Inspect after {{task.name}}',
          sectionId: scope.otherSectionId,
          assigneeId: scope.member.userId,
          dueInDays: 3,
        }),
      ]);

      const result = await runner.handle(event(scope, { ruleId: id }));

      const created = await context.prisma.task.findFirstOrThrow({
        where: { title: 'Inspect after Renew lease' },
      });
      expect(created).toMatchObject({
        projectId: scope.projectId,
        sectionId: scope.otherSectionId,
        assigneeId: scope.member.userId,
        parentTaskId: null,
      });
      expect(created.dueDate).not.toBeNull();
      expect(result.events.some((next) => next.trigger === 'TASK_CREATED')).toBe(true);
    });

    it('adds and removes collaborators, and announces each arrival', async () => {
      const scope = await setupScope();
      await context.prisma.follower.create({
        data: { workspaceId: scope.workspaceId, userId: scope.guest.userId, taskId: scope.taskId },
      });
      const id = await rule(scope, 'RUN_MANUALLY', {}, [
        action('ADD_REMOVE_COLLABORATORS', {
          add: [scope.member.userId],
          remove: [scope.guest.userId],
        }),
      ]);

      const result = await runner.handle(event(scope, { ruleId: id }));

      const followers = await context.prisma.follower.findMany({ where: { taskId: scope.taskId } });
      expect(followers.map((row) => row.userId)).toContain(scope.member.userId);
      expect(followers.map((row) => row.userId)).not.toContain(scope.guest.userId);
      expect(result.events.filter((next) => next.trigger === 'COLLABORATOR_ADDED')).toHaveLength(1);
    });

    it('removes a task from the project and writes a description', async () => {
      const scope = await setupScope();
      const id = await rule(scope, 'RUN_MANUALLY', {}, [
        action('SET_TASK_DESCRIPTION', { text: 'Owned by {{project.name}}\nSecond <line>' }),
        action('REMOVE_FROM_PROJECT'),
      ]);

      await runner.handle(event(scope, { ruleId: id }));

      const after = await task(scope.taskId);
      expect(after.projectId).toBeNull();
      expect(after.sectionId).toBeNull();
      expect(after.description).toContain('Owned by Leasing');
      expect(after.description).toContain('&lt;line&gt;');
    });
  });

  describe('conditions and section forms', () => {
    it('checks for a comment, and for being no longer blocked', async () => {
      const scope = await setupScope();
      const blocker = await context.prisma.task.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          title: 'Get approval',
          createdById: scope.owner.userId,
        },
      });
      await context.prisma.taskDependency.create({
        data: {
          workspaceId: scope.workspaceId,
          blockedTaskId: scope.taskId,
          blockingTaskId: blocker.id,
        },
      });

      const id = await rule(scope, 'RUN_MANUALLY', {}, [
        {
          nodeType: 'CONDITION',
          subtype: 'NO_LONGER_BLOCKED',
          configuration: { field: 'NO_LONGER_BLOCKED', operator: 'IS_CHECKED' },
        },
        {
          nodeType: 'CONDITION',
          subtype: 'HAS_COMMENT',
          configuration: { field: 'HAS_COMMENT', operator: 'IS_CHECKED' },
        },
        action('SET_TASK_NAME', { text: 'Ready to go' }),
      ]);

      expect((await runner.handle(event(scope, { ruleId: id }))).executed).toBe(0);

      await context.prisma.task.update({
        where: { id: blocker.id },
        data: { completedAt: new Date() },
      });
      await context.prisma.comment.create({
        data: {
          workspaceId: scope.workspaceId,
          authorId: scope.owner.userId,
          taskId: scope.taskId,
          body: 'Done?',
        },
      });

      expect((await runner.handle(event(scope, { ruleId: id }))).executed).toBe(1);
      expect((await task(scope.taskId)).title).toBe('Ready to go');
    });

    it('raises "no longer blocked" for the task a completion freed', async () => {
      const scope = await setupScope();
      const blocker = await context.prisma.task.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          title: 'Get approval',
          createdById: scope.owner.userId,
          completedAt: new Date(),
        },
      });
      await context.prisma.taskDependency.create({
        data: {
          workspaceId: scope.workspaceId,
          blockedTaskId: scope.taskId,
          blockingTaskId: blocker.id,
        },
      });

      const result = await runner.handle(
        event(scope, { trigger: 'TASK_COMPLETED', entityId: blocker.id }),
      );

      expect(result.events).toEqual([
        expect.objectContaining({ trigger: 'TASK_NO_LONGER_BLOCKED', entityId: scope.taskId }),
      ]);
    });

    it('matches "section is not…" and "section is one of…" as written', async () => {
      const scope = await setupScope();
      const notFirst = await rule(
        scope,
        'TASK_MOVED_TO_SECTION',
        { form: 'SECTION_CHANGED_TO_NOT', sectionId: scope.sectionId },
        [action('SET_TASK_NAME', { text: 'Left the first section' })],
      );
      const moved = (sectionId: string) =>
        event(scope, { trigger: 'TASK_MOVED_TO_SECTION', after: { sectionId } });

      expect((await runner.handle(moved(scope.sectionId))).executed).toBe(0);
      expect((await runner.handle(moved(scope.otherSectionId))).executed).toBe(1);

      await context.prisma.automationRule.update({
        where: { id: notFirst },
        data: {
          triggerConfig: { form: 'SECTION_CHANGED_TO_ANY_OF', sectionIds: [scope.sectionId] },
        },
      });
      expect((await runner.handle(moved(scope.otherSectionId))).executed).toBe(0);
      expect((await runner.handle(moved(scope.sectionId))).executed).toBe(1);
    });
  });

  describe('the clock', () => {
    const DAY = 86_400_000;
    const calendarDay = (offset: number) => {
      const day = new Date(Date.now() + offset * DAY);
      return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    };

    it('announces "due date is approaching" once, the morning it opens', async () => {
      const scope = await setupScope();
      const due = calendarDay(3);
      await context.prisma.task.update({ where: { id: scope.taskId }, data: { dueDate: due } });
      const id = await rule(scope, 'DUE_DATE_APPROACHING', { days: 1, timezone: 'UTC' }, [
        action('ADD_COMMENT', { body: 'Due tomorrow' }),
      ]);

      const opens = new Date(due.getTime() - DAY);

      await clock.tick(new Date(opens.getTime() - 60_000));
      expect(published).toHaveLength(0);

      await clock.tick(new Date(opens.getTime() + 60_000));
      await clock.tick(new Date(opens.getTime() + 120_000));
      expect(published).toEqual([
        expect.objectContaining({
          trigger: 'DUE_DATE_APPROACHING',
          entityId: scope.taskId,
          ruleId: id,
        }),
      ]);

      // And the event runs the rule like any other.
      expect((await runner.handle(published[0] as AutomationEvent)).executed).toBe(1);
    });

    it('fires "task is overdue" once the due day is over, for open tasks only', async () => {
      const scope = await setupScope();
      const due = calendarDay(1);
      await context.prisma.task.update({ where: { id: scope.taskId }, data: { dueDate: due } });
      const done = await context.prisma.task.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          title: 'Already done',
          dueDate: due,
          completedAt: new Date(),
          createdById: scope.owner.userId,
        },
      });
      await rule(scope, 'TASK_OVERDUE', { timezone: 'UTC' }, [
        action('ADD_COMMENT', { body: 'Late' }),
      ]);

      await clock.tick(new Date(due.getTime() + DAY + 60_000));

      expect(published.map((next) => next.entityId)).toEqual([scope.taskId]);
      expect(published.map((next) => next.entityId)).not.toContain(done.id);
    });

    it('watches a custom date field: near, then passed, each once', async () => {
      const scope = await setupScope();
      const field = await context.prisma.customField.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'Lease ends',
          type: 'DATE',
          projects: { create: { projectId: scope.projectId } },
        },
      });
      const ends = calendarDay(4);
      await context.prisma.taskCustomFieldValue.create({
        data: { taskId: scope.taskId, customFieldId: field.id, dateValue: ends },
      });
      const near = await rule(
        scope,
        'CUSTOM_DATE_APPROACHING',
        { fieldId: field.id, days: 2, timezone: 'UTC' },
        [action('ADD_COMMENT', { body: 'Lease ends soon' })],
      );
      const passed = await rule(
        scope,
        'CUSTOM_DATE_PASSED',
        { fieldId: field.id, timezone: 'UTC' },
        [action('ADD_COMMENT', { body: 'Lease has ended' })],
      );

      // The task's own due date, which no custom-date rule reads.
      await context.prisma.task.update({ where: { id: scope.taskId }, data: { dueDate: ends } });

      const opens = new Date(ends.getTime() - 2 * DAY);
      await clock.tick(new Date(opens.getTime() - 60_000));
      expect(published).toHaveLength(0);

      await clock.tick(new Date(opens.getTime() + 60_000));
      await clock.tick(new Date(opens.getTime() + 120_000));
      expect(published).toEqual([
        expect.objectContaining({
          trigger: 'CUSTOM_DATE_APPROACHING',
          entityId: scope.taskId,
          ruleId: near,
          after: expect.objectContaining({ fieldId: field.id }),
        }),
      ]);
      expect((await runner.handle(published[0] as AutomationEvent)).executed).toBe(1);

      published = [];
      await clock.tick(new Date(ends.getTime() + DAY + 60_000));
      expect(published).toEqual([
        expect.objectContaining({ trigger: 'CUSTOM_DATE_PASSED', ruleId: passed }),
      ]);
    });

    it('refuses a custom date rule with no field, or a field that is not a date', async () => {
      const scope = await setupScope();
      const text = await context.prisma.customField.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'Notes',
          type: 'TEXT',
          projects: { create: { projectId: scope.projectId } },
        },
      });

      for (const triggerConfig of [{ timezone: 'UTC' }, { fieldId: text.id, timezone: 'UTC' }]) {
        const id = await rule(
          scope,
          'CUSTOM_DATE_PASSED',
          triggerConfig,
          [action('ADD_COMMENT', { body: 'x' })],
          { publish: false },
        );
        await request(server())
          .post(`${rulesUrl(scope)}/${id}/publish`)
          .set(as(scope.owner))
          .expect((response) => expect(response.status).toBeGreaterThanOrEqual(400));
      }
    });

    it('runs a schedule on the tasks in scope, once per occurrence', async () => {
      const scope = await setupScope();
      const config = {
        frequency: 'DAILY',
        time: '09:00',
        timezone: 'UTC',
        scope: 'INCOMPLETE',
      };
      const id = await rule(scope, 'SCHEDULED_TIME', config, [
        action('ADD_COMMENT', { body: 'Daily nudge' }),
      ]);

      const next = nextOccurrence(readSchedule(config), new Date()) as Date;
      await clock.tick(new Date(next.getTime() + 60_000));
      await clock.tick(new Date(next.getTime() + 120_000));

      expect(published).toEqual([
        expect.objectContaining({ trigger: 'SCHEDULED_TIME', entityId: scope.taskId, ruleId: id }),
      ]);
    });

    it('creates a task on a schedule that runs on no tasks', async () => {
      const scope = await setupScope();
      const config = {
        frequency: 'WEEKLY',
        weekday: 1,
        time: '08:30',
        timezone: 'UTC',
        scope: 'NONE',
      };
      await rule(scope, 'SCHEDULED_TIME', config, [
        action('CREATE_TASK', { title: 'Weekly review for {{project.name}}' }),
      ]);

      const next = nextOccurrence(readSchedule(config), new Date()) as Date;
      await clock.tick(new Date(next.getTime() + 60_000));

      expect(published).toEqual([
        expect.objectContaining({ entityType: 'PROJECT', entityId: scope.projectId }),
      ]);
      expect((await runner.handle(published[0] as AutomationEvent)).executed).toBe(1);
      expect(
        await context.prisma.task.count({ where: { title: 'Weekly review for Leasing' } }),
      ).toBe(1);
    });

    it('refuses to publish a no-task schedule with a step that needs a task', async () => {
      const scope = await setupScope();
      const id = await rule(
        scope,
        'SCHEDULED_TIME',
        { frequency: 'DAILY', time: '09:00', timezone: 'UTC', scope: 'NONE' },
        [action('ASSIGN_USER', { userId: scope.member.userId })],
        { publish: false },
      );

      const refused = await request(server())
        .post(`${rulesUrl(scope)}/${id}/publish`)
        .set(as(scope.owner))
        .expect(400);
      expect(JSON.stringify(refused.body)).toContain('it can only create new ones');
    });
  });
});
