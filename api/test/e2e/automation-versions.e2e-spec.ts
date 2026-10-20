import { randomUUID } from 'node:crypto';

import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
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
 * Publishing a rule makes a version, and the version is what runs.
 *
 * The builder's saves write the draft — the rule's node rows — and nothing a
 * save does reaches a live rule until it is published again. These tests pin
 * that from the outside: through the routes a builder uses, and the runner a
 * worker runs.
 */
describe('Automation versions (e2e)', () => {
  let context: TestContext;
  let runner: AutomationRunnerService;
  let clock: AutomationClockService;
  let published: AutomationEvent[];

  beforeAll(async () => {
    context = await createTestContext();
    runner = new AutomationRunnerService(context.prisma, {
      toProject: async () => undefined,
      toProjectAudience: async () => undefined,
      toWorkspace: async () => undefined,
    } as never);
    clock = new AutomationClockService(context.prisma, {
      publish: async (event: Partial<AutomationEvent>) => {
        published.push({
          ...(event as AutomationEvent),
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
    workspaceId: string;
    projectId: string;
    sectionId: string;
    otherSectionId: string;
    taskId: string;
  }

  const register = async (name: string): Promise<Actor> => {
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
    const owner = await register('Owner');
    const member = await register('Member');

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: 'Versioned Works' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;
    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
    });

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(as(owner))
      .send({ name: 'Intake' })
      .expect(201);
    const sections = project.body.data.sections as { id: string }[];

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(as(owner))
      .send({ title: 'A task', sectionId: sections[0]?.id })
      .expect(201);

    return {
      owner,
      member,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: sections[0]?.id ?? '',
      otherSectionId: sections[1]?.id ?? '',
      taskId: task.body.data.id as string,
    };
  };

  const rulesUrl = (scope: Scope) =>
    url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);

  /** A trigger and one chain of actions under it. */
  const graph = (
    actions: { subtype: string; configuration: Record<string, unknown> }[],
    trigger = 'TASK_MOVED_TO_SECTION',
  ) => [
    { id: 't', nodeType: 'TRIGGER', subtype: trigger, configuration: {}, parentId: null, order: 0 },
    ...actions.map((action, index) => ({
      id: `a${index}`,
      nodeType: 'ACTION',
      subtype: action.subtype,
      configuration: action.configuration,
      parentId: index === 0 ? 't' : `a${index - 1}`,
      order: index + 1,
    })),
  ];

  /** A node the graph route returned, as the builder sends it back. */
  const asSaved = (node: {
    id: string;
    type: string;
    subtype: string;
    configuration: Record<string, unknown>;
    parentId: string | null;
    branchKey: string | null;
    order: number;
  }) => ({
    id: node.id,
    nodeType: node.type,
    subtype: node.subtype,
    configuration: node.configuration,
    parentId: node.parentId,
    branchKey: node.branchKey,
    order: node.order,
  });

  const assign = (userId: string) => ({ subtype: 'ASSIGN_USER', configuration: { userId } });
  const comment = (body: string) => ({ subtype: 'ADD_COMMENT', configuration: { body } });

  const createRule = async (
    scope: Scope,
    actions: { subtype: string; configuration: Record<string, unknown> }[],
  ) => {
    const created = await request(server())
      .post(rulesUrl(scope))
      .set(as(scope.owner))
      .send({ name: 'Versioned rule', triggerType: 'TASK_MOVED_TO_SECTION', nodes: graph(actions) })
      .expect(201);
    return created.body.data.id as string;
  };

  const publish = (scope: Scope, ruleId: string) =>
    request(server())
      .post(`${rulesUrl(scope)}/${ruleId}/publish`)
      .set(as(scope.owner));

  const save = (scope: Scope, ruleId: string, nodes: unknown[]) =>
    request(server())
      .patch(`${rulesUrl(scope)}/${ruleId}`)
      .set(as(scope.owner))
      .send({ nodes })
      .expect(200);

  const readGraph = async (scope: Scope, ruleId: string) =>
    (
      await request(server())
        .get(`${rulesUrl(scope)}/${ruleId}/graph`)
        .set(as(scope.owner))
    ).body.data;

  const versions = async (scope: Scope, ruleId: string) =>
    (
      await request(server())
        .get(`${rulesUrl(scope)}/${ruleId}/versions`)
        .set(as(scope.owner))
        .expect(200)
    ).body.data as { id: string; version: number; isPublished: boolean; stepCount: number }[];

  const moved = (scope: Scope, trigger = 'TASK_MOVED_TO_SECTION'): AutomationEvent => ({
    eventId: randomUUID(),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    trigger: trigger as AutomationEvent['trigger'],
    entityType: 'TASK',
    entityId: scope.taskId,
    actorId: scope.owner.userId,
    after: { sectionId: scope.sectionId },
    correlationId: randomUUID(),
    depth: 0,
  });

  const assignee = async (scope: Scope) =>
    (await context.prisma.task.findUniqueOrThrow({ where: { id: scope.taskId } })).assigneeId;

  const resetAssignee = (scope: Scope) =>
    context.prisma.task.update({ where: { id: scope.taskId }, data: { assigneeId: null } });

  // -------------------------------------------------------------------------
  describe('publishing', () => {
    it('makes version 1, and every run records the version it ran', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, [assign(scope.owner.userId)]);
      await publish(scope, ruleId).expect(200);

      const [first] = await versions(scope, ruleId);
      expect(first).toMatchObject({ version: 1, isPublished: true, stepCount: 1 });

      await runner.handle(moved(scope));
      const execution = await context.prisma.automationExecution.findFirstOrThrow({
        where: { ruleId },
      });
      expect(execution.ruleVersionId).toBe(first?.id);

      const history = await request(server())
        .get(`${rulesUrl(scope)}/${ruleId}/executions`)
        .set(as(scope.owner))
        .expect(200);
      expect(history.body.data[0].ruleVersion).toEqual({ version: 1 });
    });

    it('does not add a version when nothing changed — a pause and resume, a second press', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, [assign(scope.owner.userId)]);
      await publish(scope, ruleId).expect(200);

      await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/pause`)
        .set(as(scope.owner))
        .expect(200);
      await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/enable`)
        .set(as(scope.owner))
        .expect(200);
      // The builder saves the same canvas back, new ids and all, then publishes.
      const current = await readGraph(scope, ruleId);
      await save(scope, ruleId, current.graph.nodes.map(asSaved));
      await publish(scope, ruleId).expect(200);

      expect(await versions(scope, ruleId)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('editing a live rule', () => {
    it('changes nothing that runs until it is published again', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, [assign(scope.owner.userId)]);
      await publish(scope, ruleId).expect(200);

      await save(scope, ruleId, graph([assign(scope.member.userId)]));

      const draft = await readGraph(scope, ruleId);
      expect(draft.hasUnpublishedChanges).toBe(true);
      expect(draft.publishedVersion).toMatchObject({ version: 1, isPublished: true });

      await runner.handle(moved(scope));
      expect(await assignee(scope)).toBe(scope.owner.userId);

      await publish(scope, ruleId).expect(200);
      expect((await readGraph(scope, ruleId)).hasUnpublishedChanges).toBe(false);
      expect((await versions(scope, ruleId)).map((row) => row.version)).toEqual([2, 1]);

      await resetAssignee(scope);
      await runner.handle(moved(scope));
      expect(await assignee(scope)).toBe(scope.member.userId);
    });

    it('keeps listening for the published trigger while the draft names another', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, [assign(scope.owner.userId)]);
      await publish(scope, ruleId).expect(200);

      await save(scope, ruleId, graph([assign(scope.owner.userId)], 'TASK_COMPLETED'));

      expect((await runner.handle(moved(scope, 'TASK_COMPLETED'))).executed).toBe(0);
      expect((await runner.handle(moved(scope))).executed).toBe(1);

      await publish(scope, ruleId).expect(200);
      expect((await runner.handle(moved(scope))).executed).toBe(0);
      expect((await runner.handle(moved(scope, 'TASK_COMPLETED'))).executed).toBe(1);
    });

    it('keeps each step’s id from one save to the next', async () => {
      // An autosave that renamed every step lost whichever one was open in the
      // builder's panel: it named an id the rule no longer had.
      const scope = await setupScope();
      const ruleId = await createRule(scope, [comment('One')]);
      const before = await readGraph(scope, ruleId);
      const added = randomUUID();

      const nodes = [
        ...before.graph.nodes.map(asSaved),
        {
          id: `new-${added}`,
          nodeType: 'ACTION',
          subtype: 'ADD_COMMENT',
          configuration: { body: 'Two' },
          parentId: before.graph.nodes.at(-1).id,
          order: 9,
        },
      ];
      await save(scope, ruleId, nodes);

      const after = await readGraph(scope, ruleId);
      const ids = after.graph.nodes.map((node: { id: string }) => node.id);
      expect(ids).toEqual(
        expect.arrayContaining([...before.graph.nodes.map((n: { id: string }) => n.id), added]),
      );
    });

    it('does not let a save claim another rule’s step by its id', async () => {
      const scope = await setupScope();
      const mine = await createRule(scope, [comment('Mine')]);
      const theirs = await createRule(scope, [comment('Theirs')]);
      const theirStep = (await readGraph(scope, theirs)).graph.nodes[1].id as string;

      await save(scope, mine, [
        { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_MOVED_TO_SECTION', parentId: null },
        {
          id: theirStep,
          nodeType: 'ACTION',
          subtype: 'ADD_COMMENT',
          parentId: 't',
          configuration: { body: 'x' },
        },
      ]);

      const ids = (await readGraph(scope, mine)).graph.nodes.map((node: { id: string }) => node.id);
      expect(ids).not.toContain(theirStep);
      expect(
        await context.prisma.automationNode.count({ where: { id: theirStep, ruleId: theirs } }),
      ).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('history and revert', () => {
    const twoVersions = async (scope: Scope) => {
      const ruleId = await createRule(scope, [assign(scope.owner.userId)]);
      await publish(scope, ruleId).expect(200);
      await save(scope, ruleId, graph([assign(scope.member.userId), comment('Second')]));
      await publish(scope, ruleId).expect(200);
      const [second, first] = await versions(scope, ruleId);
      return { ruleId, first: first!, second: second! };
    };

    it('lists versions newest first and shows one with its steps', async () => {
      const scope = await setupScope();
      const { ruleId, first, second } = await twoVersions(scope);

      expect(second).toMatchObject({ version: 2, isPublished: true, stepCount: 2 });
      expect(first).toMatchObject({ version: 1, isPublished: false, stepCount: 1 });

      const detail = await request(server())
        .get(`${rulesUrl(scope)}/${ruleId}/versions/${first.id}`)
        .set(as(scope.owner))
        .expect(200);
      expect(detail.body.data.graph.nodes.map((node: { subtype: string }) => node.subtype)).toEqual(
        ['TASK_MOVED_TO_SECTION', 'ASSIGN_USER'],
      );
      expect(detail.body.data.graph.edges).toHaveLength(1);
    });

    it('puts an old version back into the draft without changing what runs', async () => {
      const scope = await setupScope();
      const { ruleId, first } = await twoVersions(scope);

      const reverted = await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/versions/${first.id}/revert`)
        .set(as(scope.owner))
        .send({})
        .expect(200);
      expect(reverted.body.data.nodes.map((node: { subtype: string }) => node.subtype)).toEqual([
        'TASK_MOVED_TO_SECTION',
        'ASSIGN_USER',
      ]);
      expect((await readGraph(scope, ruleId)).hasUnpublishedChanges).toBe(true);

      // Still version 2 running: the member is assigned and the comment posted.
      await runner.handle(moved(scope));
      expect(await assignee(scope)).toBe(scope.member.userId);

      // Published, it is a new version with the old steps; history keeps both.
      await publish(scope, ruleId).expect(200);
      const listed = await versions(scope, ruleId);
      expect(listed.map((row) => [row.version, row.stepCount])).toEqual([
        [3, 1],
        [2, 2],
        [1, 1],
      ]);

      await resetAssignee(scope);
      await runner.handle(moved(scope));
      expect(await assignee(scope)).toBe(scope.owner.userId);
    });

    it('publishes in the same call when asked to', async () => {
      const scope = await setupScope();
      const { ruleId, first } = await twoVersions(scope);

      const response = await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/versions/${first.id}/revert`)
        .set(as(scope.owner))
        .send({ publish: true })
        .expect(200);

      expect(response.body.data.status).toBe('ACTIVE');
      expect((await versions(scope, ruleId))[0]).toMatchObject({ version: 3, isPublished: true });
    });

    it('refuses a version from another rule, and a revert by someone who cannot manage rules', async () => {
      const scope = await setupScope();
      const { ruleId, first } = await twoVersions(scope);
      const other = await createRule(scope, [assign(scope.owner.userId)]);

      await request(server())
        .post(`${rulesUrl(scope)}/${other}/versions/${first.id}/revert`)
        .set(as(scope.owner))
        .send({})
        .expect(404);
      await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/versions/${first.id}/revert`)
        .set(as(scope.member))
        .send({})
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('a run that waits', () => {
    it('finishes on the version it started on, though the rule was republished', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, []);
      const waiting = (body: string) => [
        {
          id: 't',
          nodeType: 'TRIGGER',
          subtype: 'TASK_MOVED_TO_SECTION',
          parentId: null,
          order: 0,
        },
        {
          id: 'a',
          nodeType: 'ACTION',
          subtype: 'ASSIGN_USER',
          parentId: 't',
          order: 1,
          configuration: { userId: scope.member.userId },
        },
        {
          id: 'd',
          nodeType: 'DELAY',
          subtype: 'DELAY',
          parentId: 'a',
          order: 2,
          configuration: { amount: 1, unit: 'HOURS' },
        },
        {
          id: 'c',
          nodeType: 'ACTION',
          subtype: 'ADD_COMMENT',
          parentId: 'd',
          order: 3,
          configuration: { body },
        },
      ];
      await save(scope, ruleId, waiting('From version 1'));
      await publish(scope, ruleId).expect(200);

      const started = Date.now();
      await runner.handle(moved(scope));
      const run = await context.prisma.automationDelayedRun.findFirstOrThrow({ where: { ruleId } });
      const [v1] = await versions(scope, ruleId);
      expect(run.ruleVersionId).toBe(v1?.id);

      await save(scope, ruleId, waiting('From version 2'));
      await publish(scope, ruleId).expect(200);

      await clock.tick(new Date(started + 61 * 60_000));
      expect(published).toEqual([
        expect.objectContaining({ resumeFromNodeId: run.nodeId, resumeVersionId: v1?.id }),
      ]);
      await runner.handle(published[0]!);

      const comments = await context.prisma.comment.findMany({ where: { taskId: scope.taskId } });
      expect(comments.map((row) => row.body)).toEqual([expect.stringContaining('From version 1')]);
    });
  });

  // -------------------------------------------------------------------------
  describe('a rule published through the structured definition', () => {
    it('runs what was published', async () => {
      const scope = await setupScope();
      const ruleId = await createRule(scope, []);
      const definition = `${rulesUrl(scope)}/${ruleId}/definition`;

      await request(server())
        .put(definition)
        .set(as(scope.owner))
        .send({
          name: 'Structured',
          trigger: { type: 'TASK_MOVED_TO_SECTION', configuration: {} },
          branches: [
            {
              id: 'b0',
              type: 'PRIMARY',
              position: 0,
              conditionGroup: {
                id: 'g0',
                operator: 'ALL',
                conditions: [
                  {
                    id: 'c0',
                    fieldKey: 'sectionId',
                    operator: 'IS',
                    value: scope.sectionId,
                    position: 0,
                  },
                ],
              },
              actions: [
                {
                  id: 'x0',
                  actionType: 'ASSIGN_USER',
                  configuration: { userId: scope.member.userId },
                  position: 0,
                },
              ],
            },
            {
              id: 'b1',
              type: 'OTHERWISE',
              position: 1,
              conditionGroup: null,
              actions: [
                {
                  id: 'x1',
                  actionType: 'ASSIGN_USER',
                  configuration: { userId: scope.owner.userId },
                  position: 0,
                },
              ],
            },
          ],
        })
        .expect(200);
      await request(server()).post(`${definition}/publish`).set(as(scope.owner)).expect(200);

      await runner.handle(moved(scope));
      expect(await assignee(scope)).toBe(scope.member.userId);

      // The other section falls through to the fallback branch.
      await context.prisma.task.update({
        where: { id: scope.taskId },
        data: { sectionId: scope.otherSectionId, assigneeId: null },
      });
      await runner.handle({ ...moved(scope), after: { sectionId: scope.otherSectionId } });
      expect(await assignee(scope)).toBe(scope.owner.userId);
    });
  });
});
