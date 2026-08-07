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
  describe('running a rule with parentage', () => {
    /*
     * The runner reads two shapes and both have to keep working.
     *
     * A rule written before the canvas has no parentage — every `parentNodeId`
     * is null — and means "all conditions must hold, then all actions run".
     * A rule built on the canvas means the path. The presence of a single
     * parent link is what tells them apart, so these tests pin both.
     */
    const publishGraph = async (scope: Scope, nodes: Record<string, unknown>[]) => {
      const created = await request(server())
        .post(rulesUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({
          name: 'Graph rule',
          triggerType: 'TASK_MOVED_TO_SECTION',
          triggerConfig: { sectionId: scope.sectionId },
          nodes,
        })
        .expect(201);

      await request(server())
        .post(`${rulesUrl(scope)}/${created.body.data.id}/publish`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      return created.body.data.id as string;
    };

    const assigneeAfterRun = async (scope: Scope) => {
      await runner.handle(moveEvent(scope));

      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });
      return task?.assigneeId ?? null;
    };

    it('evaluates a date condition instead of quietly never matching', async () => {
      /*
       * `BEFORE` and `AFTER` were offered by the builder for every date field
       * and had no case in the evaluator, so they fell through to "unknown
       * operator" and returned false. A rule using one published cleanly and
       * could never fire — the worst shape a bug can take, because nothing
       * anywhere reports a failure.
       */
      const scope = await setupScope();

      await context.prisma.task.update({
        where: { id: scope.taskId },
        data: { dueDate: new Date('2026-01-10T00:00:00.000Z') },
      });

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'dueDate', operator: 'BEFORE', value: '2026-02-01' },
        },
        {
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: { userId: scope.owner.userId },
        },
      ]);

      expect(await assigneeAfterRun(scope)).toBe(scope.owner.userId);
    });

    it('evaluates a section condition in the words the builder writes', async () => {
      /*
       * The builder names comparisons the way a person reads them — `IS`,
       * `IS_ONE_OF` — and the evaluator only knew the query engine's names.
       * Rules seeded before the reading names existed hold `EQUALS`, so every
       * condition that worked kept working and nothing pointed at the hole:
       * only conditions built or edited in the panel were dead, and they were
       * dead silently.
       */
      const scope = await setupScope();

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'sectionId', operator: 'IS', value: scope.sectionId },
        },
        {
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: { userId: scope.owner.userId },
        },
      ]);

      expect(await assigneeAfterRun(scope)).toBe(scope.owner.userId);
    });

    it('evaluates "is one of" against the list it was given', async () => {
      const scope = await setupScope();

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: {
            field: 'sectionId',
            operator: 'IS_ONE_OF',
            value: [scope.otherSectionId, scope.sectionId],
          },
        },
        {
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: { userId: scope.owner.userId },
        },
      ]);

      expect(await assigneeAfterRun(scope)).toBe(scope.owner.userId);
    });

    it('still blocks when the builder’s condition does not hold', async () => {
      // The other half. A translation that made every operator pass would make
      // these tests green and every rule fire on everything.
      const scope = await setupScope();

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'sectionId', operator: 'IS_NOT', value: scope.sectionId },
        },
        {
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: { userId: scope.owner.userId },
        },
      ]);

      expect(await assigneeAfterRun(scope)).toBeNull();
    });

    it('skips a rule that will not chain when another rule caused the event', async () => {
      /*
       * The whole point of the setting.
       *
       * A depth above zero means something else in this chain raised the event,
       * which is exactly the case somebody is turning off when they say this
       * rule answers people rather than other rules. Asserted through the
       * runner rather than by reading the column, because a stored flag nothing
       * consults is the failure being guarded against.
       */
      const scope = await setupScope();
      const ruleId = await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: { userId: scope.owner.userId },
        },
      ]);

      await request(server())
        .patch(`${rulesUrl(scope)}/${ruleId}`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ allowChaining: false })
        .expect(200);

      await runner.handle(moveEvent(scope, { depth: 1 }));

      const afterChained = await context.prisma.task.findUnique({ where: { id: scope.taskId } });
      expect(afterChained?.assigneeId).toBeNull();

      // And still runs when a person did it, which is the half that would make
      // a too-eager guard look like a broken rule.
      await runner.handle(moveEvent(scope, { depth: 0 }));

      const afterDirect = await context.prisma.task.findUnique({ where: { id: scope.taskId } });
      expect(afterDirect?.assigneeId).toBe(scope.owner.userId);
    });

    /*
     * The three actions whose settings the builder and the runner named
     * differently.
     *
     * These are written the way the *builder* writes them and asserted on the
     * task, so a key nothing reads fails here rather than shipping as a rule
     * that runs, reports success, and changes nothing. That is what each of
     * these did: the form stored a definition id under `statusDefinitionId`
     * while the runner read `status`, so it wrote an empty string.
     */
    it('sets a status the builder chose, as a definition', async () => {
      const scope = await setupScope();

      const definition = await context.prisma.statusDefinition.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          name: 'In review',
          slug: 'in-review',
          category: 'ACTIVE',
          position: 1,
        },
      });

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        { nodeType: 'ACTION', subtype: 'UPDATE_STATUS', configuration: { status: definition.id } },
      ]);

      await runner.handle(moveEvent(scope));

      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });
      expect(task?.statusDefinitionId).toBe(definition.id);
    });

    it('sets a status the builder chose, as a legacy enum', async () => {
      // A workspace with no definitions of its own is offered the enums, so the
      // same key legitimately holds either shape and both have to land.
      const scope = await setupScope();

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        { nodeType: 'ACTION', subtype: 'UPDATE_STATUS', configuration: { status: 'DONE' } },
      ]);

      await runner.handle(moveEvent(scope));

      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });
      expect(task?.status).toBe('DONE');
      expect(task?.completedAt).not.toBeNull();
    });

    it('sets a priority the builder chose', async () => {
      const scope = await setupScope();

      const definition = await context.prisma.priorityDefinition.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'Urgent',
          slug: 'urgent',
          level: 1,
        },
      });

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'ACTION',
          subtype: 'UPDATE_PRIORITY',
          configuration: { priority: definition.id },
        },
      ]);

      await runner.handle(moveEvent(scope));

      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });
      expect(task?.priorityDefinitionId).toBe(definition.id);
    });

    it('sets a custom field the builder chose', async () => {
      const scope = await setupScope();

      const field = await context.prisma.customField.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'Effort',
          type: 'TEXT',
          projects: { create: { projectId: scope.projectId, position: 0 } },
        },
      });

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'ACTION',
          subtype: 'SET_CUSTOM_FIELD',
          configuration: { fieldId: field.id, value: 'Large' },
        },
      ]);

      await runner.handle(moveEvent(scope));

      const stored = await context.prisma.taskCustomFieldValue.findUnique({
        where: { taskId_customFieldId: { taskId: scope.taskId, customFieldId: field.id } },
      });
      expect(stored?.textValue).toBe('Large');
    });

    it('still honours a rule stored under the old key names', async () => {
      /*
       * The migration rewrites what it can reach. This covers what it cannot —
       * a draft held in a browser, a rule restored from a backup — because
       * dropping the fallback would break those on exactly the release that
       * fixed the bug for everybody else.
       */
      const scope = await setupScope();

      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'ACTION',
          subtype: 'UPDATE_STATUS',
          configuration: { statusDefinitionId: 'IN_PROGRESS' },
        },
      ]);

      await runner.handle(moveEvent(scope));

      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });
      expect(task?.status).toBe('IN_PROGRESS');
    });

    it('still runs a flat rule exactly as it always did', async () => {
      // The regression that matters: nine rules exist with no parentage, and a
      // tree walk would treat each of their nodes as its own root.
      const scope = await setupScope();
      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: { userId: scope.owner.userId },
        },
      ]);

      expect(await assigneeAfterRun(scope)).toBe(scope.owner.userId);
    });

    it('still skips a flat rule whose condition does not hold', async () => {
      const scope = await setupScope();
      await publishGraph(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        {
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          configuration: { field: 'priority', operator: 'EQUALS', value: 'CRITICAL' },
        },
        {
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          configuration: { userId: scope.owner.userId },
        },
      ]);

      expect(await assigneeAfterRun(scope)).toBeNull();
    });

    it('runs the actions under a condition that holds', async () => {
      const scope = await setupScope();
      await publishGraph(scope, [
        { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', parentId: null },
        {
          id: 'c',
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          parentId: 't',
          configuration: { field: 'priority', operator: 'NOT_EQUALS', value: 'CRITICAL' },
        },
        {
          id: 'a',
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          parentId: 'c',
          configuration: { userId: scope.owner.userId },
        },
      ]);

      expect(await assigneeAfterRun(scope)).toBe(scope.owner.userId);
    });

    it('stops only what hangs off a condition that does not', async () => {
      /*
       * The difference a tree makes. Flat, one failing condition skips the
       * whole rule; on a path, it stops what follows *it* and leaves a sibling
       * path alone.
       */
      const scope = await setupScope();
      await publishGraph(scope, [
        { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', parentId: null },
        {
          id: 'c',
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          parentId: 't',
          configuration: { field: 'priority', operator: 'EQUALS', value: 'CRITICAL' },
        },
        {
          id: 'blocked',
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          parentId: 'c',
          configuration: { userId: scope.owner.userId },
        },
        {
          id: 'sibling',
          nodeType: 'ACTION',
          subtype: 'UPDATE_PRIORITY',
          parentId: 't',
          configuration: { priority: 'HIGH' },
        },
      ]);

      await runner.handle(moveEvent(scope));
      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });

      expect(task?.assigneeId).toBeNull();
      expect(task?.priority).toBe('HIGH');
    });

    it('takes the matching arm of a branch', async () => {
      const scope = await setupScope();
      await publishGraph(scope, [
        { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', parentId: null },
        {
          id: 'b',
          nodeType: 'BRANCH',
          subtype: 'FIELD_COMPARISON',
          parentId: 't',
          configuration: { field: 'priority', operator: 'NOT_EQUALS', value: 'CRITICAL' },
        },
        {
          id: 'match',
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          parentId: 'b',
          branchKey: 'match',
          configuration: { userId: scope.owner.userId },
        },
        {
          id: 'else',
          nodeType: 'ACTION',
          subtype: 'UPDATE_PRIORITY',
          parentId: 'b',
          branchKey: 'else',
          configuration: { priority: 'LOW' },
        },
      ]);

      await runner.handle(moveEvent(scope));
      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });

      expect(task?.assigneeId).toBe(scope.owner.userId);
      expect(task?.priority).not.toBe('LOW');
    });

    it('takes the else arm when the branch does not match', async () => {
      const scope = await setupScope();
      await publishGraph(scope, [
        { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', parentId: null },
        {
          id: 'b',
          nodeType: 'BRANCH',
          subtype: 'FIELD_COMPARISON',
          parentId: 't',
          configuration: { field: 'priority', operator: 'EQUALS', value: 'CRITICAL' },
        },
        {
          id: 'match',
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          parentId: 'b',
          branchKey: 'match',
          configuration: { userId: scope.owner.userId },
        },
        {
          id: 'else',
          nodeType: 'ACTION',
          subtype: 'UPDATE_PRIORITY',
          parentId: 'b',
          branchKey: 'else',
          configuration: { priority: 'LOW' },
        },
      ]);

      await runner.handle(moveEvent(scope));
      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });

      expect(task?.assigneeId).toBeNull();
      expect(task?.priority).toBe('LOW');
    });

    it('runs sequential actions in order down a path', async () => {
      const scope = await setupScope();
      await publishGraph(scope, [
        { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', parentId: null },
        {
          id: 'a1',
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          parentId: 't',
          configuration: { userId: scope.owner.userId },
        },
        {
          id: 'a2',
          nodeType: 'ACTION',
          subtype: 'UPDATE_PRIORITY',
          parentId: 'a1',
          configuration: { priority: 'HIGH' },
        },
      ]);

      await runner.handle(moveEvent(scope));
      const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });

      expect(task?.assigneeId).toBe(scope.owner.userId);
      expect(task?.priority).toBe('HIGH');
    });

    /* ------------------------------------------------------------------ */
    /* Branch rows                                                         */
    /* ------------------------------------------------------------------ */

    /*
     * A rule's branches are the conditions hanging straight off its trigger,
     * and they are alternatives to one another: "check if… otherwise if…
     * otherwise". First match wins.
     *
     * Every one of these would pass under a plain tree walk *except* by running
     * more branches than it should, so each asserts on what did not happen as
     * well as on what did. That is the whole failure: a rule that quietly does
     * two contradictory things to one task.
     */
    describe('branch rows', () => {
      /** One row: a condition under the trigger, with an action beside it. */
      const row = (
        id: string,
        configuration: Record<string, unknown>,
        action: Record<string, unknown>,
        order: number,
      ) => [
        {
          id,
          nodeType: 'CONDITION',
          subtype: 'FIELD_COMPARISON',
          parentId: 't',
          configuration,
          order,
        },
        { ...action, id: `${id}-action`, parentId: id, order: order + 0.5 },
      ];

      const trigger = {
        id: 't',
        nodeType: 'TRIGGER',
        subtype: 'TASK_MOVED_TO_SECTION',
        parentId: null,
        order: 0,
      };

      const assign = (scope: Scope) => ({
        nodeType: 'ACTION',
        subtype: 'ASSIGN_USER',
        configuration: { userId: scope.owner.userId },
      });

      const setPriority = (priority: string) => ({
        nodeType: 'ACTION',
        subtype: 'UPDATE_PRIORITY',
        configuration: { priority },
      });

      const matches = { field: 'title', operator: 'CONTAINS', value: 'task' };
      const misses = { field: 'title', operator: 'EQUALS', value: 'something else' };

      it('runs the first branch that matches and no other', async () => {
        const scope = await setupScope();

        await publishGraph(scope, [
          trigger,
          ...row('r1', matches, setPriority('HIGH'), 1),
          ...row('r2', matches, assign(scope), 3),
          ...row('r3', { fallback: true }, setPriority('LOW'), 5),
        ]);

        await runner.handle(moveEvent(scope));
        const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });

        expect(task?.priority).toBe('HIGH');
        // The second row's condition holds just as well, and must not run: two
        // branches acting on one event is the rule contradicting itself.
        expect(task?.assigneeId).toBeNull();
      });

      it('falls through to the next branch when the first does not match', async () => {
        const scope = await setupScope();

        await publishGraph(scope, [
          trigger,
          ...row('r1', misses, setPriority('HIGH'), 1),
          ...row('r2', matches, assign(scope), 3),
          ...row('r3', { fallback: true }, setPriority('LOW'), 5),
        ]);

        await runner.handle(moveEvent(scope));
        const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });

        expect(task?.assigneeId).toBe(scope.owner.userId);
        expect(task?.priority).not.toBe('HIGH');
        expect(task?.priority).not.toBe('LOW');
      });

      it('runs the fallback only when nothing before it matched', async () => {
        /*
         * The fallback carries no comparison at all, which every operator in
         * the evaluator reads as "unknown" and answers false. Without knowing
         * what the flag means, the one row somebody added to catch everything
         * would catch nothing.
         */
        const scope = await setupScope();

        await publishGraph(scope, [
          trigger,
          ...row('r1', misses, setPriority('HIGH'), 1),
          ...row('r2', misses, setPriority('LOW'), 3),
          ...row('r3', { fallback: true }, assign(scope), 5),
        ]);

        await runner.handle(moveEvent(scope));
        const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });

        expect(task?.assigneeId).toBe(scope.owner.userId);
        expect(task?.priority).not.toBe('HIGH');
        expect(task?.priority).not.toBe('LOW');
      });

      it('reads the branches in stored order, not in the order they arrived', async () => {
        // The canvas can add a question in front of the fallback without
        // rewriting what is already there, so the array a save happens to send
        // is not the order the rule runs in — `position` is.
        const scope = await setupScope();

        await publishGraph(scope, [
          trigger,
          ...row('r3', { fallback: true }, setPriority('LOW'), 5),
          ...row('r1', matches, assign(scope), 1),
        ]);

        await runner.handle(moveEvent(scope));
        const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });

        expect(task?.assigneeId).toBe(scope.owner.userId);
        expect(task?.priority).not.toBe('LOW');
      });

      it('does nothing when no branch matches and there is no fallback', async () => {
        const scope = await setupScope();

        await publishGraph(scope, [
          trigger,
          ...row('r1', misses, assign(scope), 1),
          ...row('r2', misses, setPriority('LOW'), 3),
        ]);

        await runner.handle(moveEvent(scope));

        const task = await context.prisma.task.findUnique({ where: { id: scope.taskId } });
        expect(task?.assigneeId).toBeNull();
        expect(task?.priority).not.toBe('LOW');

        // Recorded as a skip with a reason, so the history says "did not match"
        // rather than leaving somebody to wonder whether it ran at all.
        const execution = await context.prisma.automationExecution.findFirst({
          where: { projectId: scope.projectId },
        });
        expect(execution?.status).toBe('SKIPPED');
      });

      it('leaves a rule with a single branch exactly as it was', async () => {
        /*
         * The regression that matters most: every canvas rule written before
         * branches became rows has one condition under its trigger, and "first
         * match wins" over a list of one has to mean what it always did.
         */
        const scope = await setupScope();

        await publishGraph(scope, [trigger, ...row('r1', matches, assign(scope), 1)]);

        expect(await assigneeAfterRun(scope)).toBe(scope.owner.userId);
      });

      it('leaves a single branch that does not hold exactly as it was', async () => {
        const scope = await setupScope();

        await publishGraph(scope, [trigger, ...row('r1', misses, assign(scope), 1)]);

        expect(await assigneeAfterRun(scope)).toBeNull();
      });
    });
  });

  describe('the graph endpoints', () => {
    const draftWithNodes = async (scope: Scope, nodes: Record<string, unknown>[]) => {
      const created = await request(server())
        .post(rulesUrl(scope))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Graph probe', triggerType: 'TASK_MOVED_TO_SECTION', nodes })
        .expect(201);

      return created.body.data.id as string;
    };

    const readGraph = async (scope: Scope, ruleId: string) => {
      const response = await request(server())
        .get(`${rulesUrl(scope)}/${ruleId}/graph`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .expect(200);

      return response.body.data.graph as {
        nodes: {
          id: string;
          type: string;
          parentId: string | null;
          position: { x: number; y: number };
        }[];
        edges: { source: string; target: string; kind: string }[];
      };
    };

    const check = async (scope: Scope, ruleId: string, body: Record<string, unknown>) => {
      const response = await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/validate`)
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send(body)
        .expect(200);

      return response.body.data as {
        publishable: boolean;
        issues: { level: string; message: string }[];
      };
    };

    it('lays out a rule built before the canvas existed', async () => {
      /*
       * Every node of an old rule sits at (0, 0) — the columns are non-nullable
       * with a zero default, so there is no telling "never placed" from "placed
       * at the origin". Drawn literally they would stack on top of each other,
       * and an existing rule would look broken rather than un-arranged.
       */
      const scope = await setupScope();
      const ruleId = await draftWithNodes(scope, [
        { nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION' },
        { nodeType: 'CONDITION', subtype: 'FIELD_COMPARISON' },
        { nodeType: 'ACTION', subtype: 'ASSIGN_USER' },
      ]);

      const xs = (await readGraph(scope, ruleId)).nodes.map((node) => node.position.x);

      expect(new Set(xs).size).toBe(3);
      expect(xs[0]).toBeLessThan(xs[1] as number);
      expect(xs[1]).toBeLessThan(xs[2] as number);
    });

    it('keeps positions somebody actually chose', async () => {
      const scope = await setupScope();
      const ruleId = await draftWithNodes(scope, [
        {
          id: 'trigger-1',
          nodeType: 'TRIGGER',
          subtype: 'TASK_MOVED_TO_SECTION',
          position: { x: 123, y: 456 },
        },
      ]);

      expect((await readGraph(scope, ruleId)).nodes[0]?.position).toEqual({ x: 123, y: 456 });
    });

    it('derives an edge from each parent, and maps client ids to real ones', async () => {
      // No edge table: parentNodeId already says what an edge row would, and
      // keeping both is how two answers to one question start disagreeing. The
      // builder's own ids never become database keys — one that did would let a
      // caller point a parent at a row it does not own.
      const scope = await setupScope();
      const ruleId = await draftWithNodes(scope, [
        { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', parentId: null },
        { id: 'a', nodeType: 'ACTION', subtype: 'ASSIGN_USER', parentId: 't' },
      ]);

      const { nodes, edges } = await readGraph(scope, ruleId);
      const trigger = nodes.find((node) => node.type === 'TRIGGER');
      const action = nodes.find((node) => node.type === 'ACTION');

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({ source: trigger?.id, target: action?.id, kind: 'DEFAULT' });
      expect(action?.parentId).toBe(trigger?.id);
      expect(trigger?.id).not.toBe('t');
    });

    it('reports why a graph cannot be published, without saving it', async () => {
      const scope = await setupScope();
      const ruleId = await draftWithNodes(scope, []);

      const result = await check(scope, ruleId, { name: '', nodes: [] });

      expect(result.publishable).toBe(false);
      expect(result.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining(['Give the rule a name.', 'Add at least one action.']),
      );
    });

    it('refuses a step type nothing executes', async () => {
      /*
       * DELAY is in the schema and nothing runs it. A published rule containing
       * one would look like it waits and would run straight through — worse
       * than not offering it at all. BRANCH was refused for the same reason
       * until the runner learned to walk the tree.
       */
      const scope = await setupScope();
      const ruleId = await draftWithNodes(scope, []);

      const result = await check(scope, ruleId, {
        name: 'Has a delay',
        nodes: [
          { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null },
          { id: 'd', nodeType: 'DELAY', subtype: 'WAIT', parentId: 't' },
          { id: 'a', nodeType: 'ACTION', subtype: 'ASSIGN_USER', parentId: 'd' },
        ],
      });

      expect(result.publishable).toBe(false);
      expect(result.issues.map((issue) => issue.message)).toContain(
        'This step type cannot run yet.',
      );
    });

    it('accepts a branch, now that the runner takes one arm', async () => {
      const scope = await setupScope();
      const ruleId = await draftWithNodes(scope, []);

      const result = await check(scope, ruleId, {
        name: 'Has a branch',
        nodes: [
          { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null },
          {
            id: 'b',
            nodeType: 'BRANCH',
            subtype: 'FIELD_COMPARISON',
            parentId: 't',
            configuration: { field: 'priority', operator: 'EQUALS', value: 'HIGH' },
          },
          {
            id: 'm',
            nodeType: 'ACTION',
            subtype: 'ASSIGN_USER',
            parentId: 'b',
            branchKey: 'match',
            configuration: { userId: scope.owner.userId },
          },
        ],
      });

      expect(result.issues.map((issue) => issue.message)).not.toContain(
        'This step type cannot run yet.',
      );
    });

    it('warns rather than refuses when an action can re-fire its own trigger', async () => {
      // Occasionally what somebody means, and the runner already has depth
      // limits and correlation ids. Refusing would block a legitimate rule to
      // prevent a survivable one.
      const scope = await setupScope();
      const ruleId = await draftWithNodes(scope, []);

      const result = await check(scope, ruleId, {
        name: 'Loop risk',
        nodes: [
          { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_STATUS_CHANGED', parentId: null },
          { id: 'a', nodeType: 'ACTION', subtype: 'UPDATE_STATUS', parentId: 't' },
        ],
      });

      expect(result.publishable).toBe(true);
      expect(
        result.issues.filter((issue) => issue.level === 'WARNING').map((issue) => issue.message),
      ).toContain('This action can set off the same trigger again.');
    });

    it('refuses a graph naming a section from another project', async () => {
      const scope = await setupScope();
      const other = await setupScope();
      const ruleId = await draftWithNodes(scope, []);

      const result = await check(scope, ruleId, {
        name: 'Cross-project',
        nodes: [
          { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null },
          {
            id: 'a',
            nodeType: 'ACTION',
            subtype: 'MOVE_TO_SECTION',
            parentId: 't',
            configuration: { sectionId: other.sectionId },
          },
        ],
      });

      expect(result.issues.map((issue) => issue.message)).toContain(
        'That section is no longer in this project.',
      );
    });
  });

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

  // -------------------------------------------------------------------------
  /**
   * The catalogue, over the wire, answered from one project.
   *
   * The unit spec pins `available` to the engine; these pin the other half —
   * that the lists and the values in them belong to *this* project. A section
   * from somebody else's project or a status the board stopped showing produces
   * a rule that saves, publishes, and can never match.
   */
  describe('the builder’s metadata', () => {
    interface CatalogueEntry {
      subtype: string;
      label: string;
      category: string;
      available: boolean;
      reason: string | null;
      fieldId?: string;
      fieldName?: string;
    }

    interface Metadata {
      triggers: (CatalogueEntry & {
        configForms: { form: string; label: string; available: boolean; reason: string | null }[];
      })[];
      conditions: (CatalogueEntry & { valueType: string })[];
      actions: CatalogueEntry[];
      conditionFields: { field: string; valueKind: string; options?: unknown[] }[];
      sections: { id: string; name: string }[];
      statuses: { id: string; name: string }[];
      priorities: { id: string; name: string }[];
      customFields: { id: string; name: string; type: string; options: { label: string }[] }[];
      capabilities: Record<string, unknown>;
      permissions: Record<string, unknown>;
    }

    const readMetadata = async (scope: Scope, token = scope.owner.token): Promise<Metadata> => {
      const response = await request(server())
        .get(`${rulesUrl(scope)}/metadata`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      return response.body.data as Metadata;
    };

    /** A workspace field, attached to one project, with two options. */
    const addCustomField = async (
      scope: Scope,
      name: string,
      type: 'SINGLE_SELECT' | 'NUMBER' = 'SINGLE_SELECT',
      projectId = scope.projectId,
    ) => {
      const field = await context.prisma.customField.create({
        data: {
          workspaceId: scope.workspaceId,
          name,
          type,
          projects: { create: { projectId } },
          ...(type === 'SINGLE_SELECT'
            ? {
                options: {
                  create: [
                    { label: 'Low', position: 0 },
                    { label: 'High', position: 1 },
                  ],
                },
              }
            : {}),
        },
      });

      return field.id;
    };

    it('explains every entry it will not let somebody choose', async () => {
      /*
       * The convention, end to end. A greyed row with no explanation says "not
       * for you" without saying why or whether that changes, and is worse than
       * the row being absent — so this is the property worth testing over the
       * wire rather than only where the lists are built.
       */
      const scope = await setupScope();
      await addCustomField(scope, 'Risk');

      const metadata = await readMetadata(scope);
      const entries = [...metadata.triggers, ...metadata.conditions, ...metadata.actions];

      expect(entries.length).toBeGreaterThan(0);

      const unexplained = entries
        .filter((entry) => !entry.available)
        .filter((entry) => typeof entry.reason !== 'string' || entry.reason.trim() === '');

      expect(unexplained.map((entry) => `${entry.category} / ${entry.label}`)).toEqual([]);

      const forms = metadata.triggers.flatMap((trigger) => trigger.configForms);
      expect(forms.filter((form) => !form.available && !form.reason)).toEqual([]);
    });

    it('generates the custom field rows from the fields the project really has', async () => {
      const scope = await setupScope();
      await addCustomField(scope, 'Risk', 'SINGLE_SELECT');
      await addCustomField(scope, 'Effort', 'NUMBER');

      const metadata = await readMetadata(scope);

      expect(metadata.customFields.map((field) => field.name)).toEqual(['Effort', 'Risk']);
      // The options travel with the field: "Risk is…" is unusable without the
      // values Risk can take, and a request per row would be absurd.
      expect(
        metadata.customFields.find((field) => field.name === 'Risk')?.options.map((o) => o.label),
      ).toEqual(['Low', 'High']);

      const generated = metadata.conditions.filter((entry) => entry.category === 'Custom field is');
      expect(generated.map((entry) => entry.label)).toEqual(['Effort is…', 'Risk is…']);
      expect(generated.map((entry) => entry.fieldName)).toEqual(['Effort', 'Risk']);
      expect(generated.every((entry) => entry.fieldId)).toBe(true);
      expect(generated.map((entry) => entry.valueType)).toEqual(['NUMBER', 'SINGLE_SELECT']);

      const writes = metadata.actions.filter(
        (entry) => entry.category === 'Change custom field to…',
      );
      expect(writes.map((entry) => entry.label)).toEqual(['Change Effort to…', 'Change Risk to…']);
      expect(writes.every((entry) => entry.subtype === 'SET_CUSTOM_FIELD')).toBe(true);
      // The engine writes custom fields and cannot read them, so the same field
      // is an available action and an unavailable check.
      expect(writes.every((entry) => entry.available)).toBe(true);
      expect(generated.every((entry) => !entry.available && entry.reason)).toBe(true);
    });

    it('leaves out a field another project uses, and one that was archived', async () => {
      const scope = await setupScope();

      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Somebody else’s project' })
        .expect(201);

      await addCustomField(scope, 'Mine');
      await addCustomField(scope, 'Theirs', 'SINGLE_SELECT', other.body.data.id as string);

      const archived = await addCustomField(scope, 'Retired');
      await context.prisma.customField.update({
        where: { id: archived },
        data: { isArchived: true },
      });

      const metadata = await readMetadata(scope);

      expect(metadata.customFields.map((field) => field.name)).toEqual(['Mine']);
      expect(
        metadata.conditions.filter((entry) => entry.category === 'Custom field is').length,
      ).toBe(1);
    });

    it('offers this project’s sections and never another project’s', async () => {
      /*
       * Scoping rather than tidiness. A rule that moves a task into another
       * project's section is a reach across a tenant boundary, and the runner
       * refuses it at execution time — so a form that offers one produces a rule
       * that looks right and quietly fails every time it runs.
       */
      const scope = await setupScope();

      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set('Authorization', `Bearer ${scope.owner.token}`)
        .send({ name: 'Somebody else’s project' })
        .expect(201);

      const theirs = await context.prisma.section.create({
        data: {
          workspaceId: scope.workspaceId,
          projectId: other.body.data.id as string,
          name: 'Their column',
          position: 0,
        },
      });

      const metadata = await readMetadata(scope);
      const ids = metadata.sections.map((section) => section.id);

      expect(ids).toContain(scope.sectionId);
      expect(ids).not.toContain(theirs.id);

      const mine = await context.prisma.section.findMany({
        where: { projectId: scope.projectId },
        orderBy: { position: 'asc' },
      });
      expect(ids).toEqual(mine.map((section) => section.id));
    });

    it('drops an archived status and stops mixing the workspace set into the project’s', async () => {
      /*
       * The old query was `OR: [{ projectId }, { projectId: null }]` with no
       * archive filter, so a project that had defined its own statuses saw them
       * *and* the workspace's, duplicated — with nothing to say which of two
       * identically named rows a rule would compare against. Archived rows came
       * through as well.
       */
      const scope = await setupScope();

      // Seeded here rather than relied upon: a workspace only grows definitions
      // once something reads a project view, so this flow has none of its own.
      await context.prisma.statusDefinition.createMany({
        data: [
          {
            workspaceId: scope.workspaceId,
            name: 'Workspace wide',
            slug: 'workspace-wide',
            category: 'NOT_STARTED',
            position: 0,
          },
          {
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            name: 'Triage',
            slug: 'triage',
            category: 'NOT_STARTED',
            position: 0,
          },
          {
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            name: 'Retired',
            slug: 'retired',
            category: 'CANCELLED',
            position: 1,
            isArchived: true,
          },
        ],
      });

      const metadata = await readMetadata(scope);

      expect(metadata.statuses.map((status) => status.name)).toEqual(['Triage']);
    });

    it('falls back to the workspace set for a project with no statuses of its own', async () => {
      // A project that has never overridden its statuses has none, and an empty
      // list would leave "Status is…" impossible to complete.
      const scope = await setupScope();

      await context.prisma.statusDefinition.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'Workspace wide',
          slug: 'workspace-wide',
          category: 'NOT_STARTED',
          position: 0,
        },
      });

      const metadata = await readMetadata(scope);

      expect(metadata.statuses.map((status) => status.name)).toEqual(['Workspace wide']);
    });

    it('drops an archived priority', async () => {
      const scope = await setupScope();

      await context.prisma.priorityDefinition.createMany({
        data: [
          { workspaceId: scope.workspaceId, name: 'Low', slug: 'low', level: 1 },
          { workspaceId: scope.workspaceId, name: 'Retired', slug: 'retired', level: 2 },
        ],
      });
      await context.prisma.priorityDefinition.update({
        where: { workspaceId_slug: { workspaceId: scope.workspaceId, slug: 'retired' } },
        data: { isArchived: true },
      });

      const metadata = await readMetadata(scope);

      expect(metadata.priorities.map((priority) => priority.name)).toEqual(['Low']);
    });

    it('offers the forms this project’s own values', async () => {
      const scope = await setupScope();
      const metadata = await readMetadata(scope);

      expect(metadata.triggers.length).toBeGreaterThan(0);
      expect(metadata.sections.length).toBeGreaterThan(0);

      // A status field offering free text is a field that silently never
      // matches.
      const status = metadata.conditionFields.find((field) => field.field === 'status');
      expect(status?.valueKind).toBe('ENUM');
      expect(status?.options?.length).toBeGreaterThan(0);
    });

    it('says which of the four move forms the engine can honour', async () => {
      const scope = await setupScope();
      const metadata = await readMetadata(scope);

      const moved = metadata.triggers.find((entry) => entry.subtype === 'TASK_MOVED_TO_SECTION');

      expect(moved?.configForms.map((form) => form.label)).toEqual([
        'Section is changed',
        'Section is…',
        'Section is not…',
        'Section is one of…',
      ]);
      expect(moved?.configForms.filter((form) => form.available).map((form) => form.form)).toEqual([
        'SECTION_CHANGED',
        'SECTION_CHANGED_TO',
      ]);
    });

    it('tells a member they may read the rules and not write them', async () => {
      /*
       * Sent so the builder can present a rule as read-only rather than let
       * somebody fill in a form and meet a 403 on save. It is not the check —
       * the service still refuses — because a permission the client is told
       * about is one the client could ignore.
       */
      const scope = await setupScope();

      expect(await readMetadata(scope, scope.owner.token)).toMatchObject({
        permissions: { role: 'OWNER', canView: true, canCreate: true, canPublish: true },
      });

      expect(await readMetadata(scope, scope.member.token)).toMatchObject({
        permissions: {
          role: 'MEMBER',
          canView: true,
          canCreate: false,
          canEdit: false,
          canPublish: false,
          canDelete: false,
        },
      });
    });
  });
});
