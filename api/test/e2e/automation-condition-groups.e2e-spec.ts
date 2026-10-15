import { randomUUID } from 'node:crypto';

import { API_PREFIX } from '@coretask/contracts';
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
 * A "Check if" that asks more than one thing: "any of" these, "all of" these,
 * and a group inside a group — through the routes a builder uses, judged by
 * the runner a worker runs.
 */
describe('Automation condition groups (e2e)', () => {
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
  }

  const as = (scope: Scope) => ({ Authorization: `Bearer ${scope.token}` });

  const setupScope = async (): Promise<Scope> => {
    const registered = await request(server())
      .post(url('/auth/register'))
      .send({ name: 'Owner', email: uniqueEmail(), password: VALID_PASSWORD })
      .expect(201);
    const token = registered.body.data.accessToken as string;

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'Grouped Works' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set({ Authorization: `Bearer ${token}` })
      .send({ name: 'Intake' })
      .expect(201);
    const sections = project.body.data.sections as { id: string; name: string }[];

    return {
      token,
      userId: registered.body.data.user.id as string,
      workspaceId,
      projectId: project.body.data.id as string,
      sectionId: sections[0]?.id ?? '',
      otherSectionId: sections[1]?.id ?? '',
    };
  };

  const rulesUrl = (scope: Scope, projectId = scope.projectId) =>
    url(`/workspaces/${scope.workspaceId}/projects/${projectId}/automations`);

  const task = async (scope: Scope, fields: Record<string, unknown>) =>
    (
      await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set(as(scope))
        .send({ title: 'A task', sectionId: scope.sectionId, ...fields })
        .expect(201)
    ).body.data.id as string;

  /** A rule whose one branch checks `condition`, and comments when it holds. */
  const ruleChecking = async (scope: Scope, condition: Record<string, unknown>) => {
    const created = await request(server())
      .post(rulesUrl(scope))
      .set(as(scope))
      .send({
        name: 'Grouped rule',
        triggerType: 'TASK_CREATED',
        nodes: [
          { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null, order: 0 },
          {
            id: 'c',
            nodeType: 'CONDITION',
            subtype: 'FIELD_COMPARISON',
            configuration: condition,
            parentId: 't',
            order: 1,
          },
          {
            id: 'a',
            nodeType: 'ACTION',
            subtype: 'ADD_COMMENT',
            configuration: { body: 'It held' },
            parentId: 'c',
            order: 2,
          },
        ],
      })
      .expect(201);
    return created.body.data.id as string;
  };

  const publish = (scope: Scope, ruleId: string) =>
    request(server())
      .post(`${rulesUrl(scope)}/${ruleId}/publish`)
      .set(as(scope));

  const created = (scope: Scope, taskId: string): AutomationEvent => ({
    eventId: randomUUID(),
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    trigger: 'TASK_CREATED',
    entityType: 'TASK',
    entityId: taskId,
    actorId: scope.userId,
    correlationId: randomUUID(),
    depth: 0,
  });

  /** Runs the rule on a new task with these fields; whether its condition held. */
  const holdsFor = async (scope: Scope, fields: Record<string, unknown>) => {
    const taskId = await task(scope, fields);
    await runner.handle(created(scope, taskId));
    return (await context.prisma.comment.count({ where: { taskId } })) === 1;
  };

  const is = (field: string, value: unknown) => ({ field, operator: 'IS', value });

  // -------------------------------------------------------------------------
  describe('running', () => {
    it('holds an "any of" group when one of its conditions does', async () => {
      const scope = await setupScope();
      const ruleId = await ruleChecking(scope, {
        match: 'ANY',
        conditions: [is('priority', 'HIGH'), is('priority', 'CRITICAL')],
      });
      await publish(scope, ruleId).expect(200);

      expect(await holdsFor(scope, { priority: 'CRITICAL' })).toBe(true);
      expect(await holdsFor(scope, { priority: 'HIGH' })).toBe(true);
      expect(await holdsFor(scope, { priority: 'LOW' })).toBe(false);
    });

    it('holds an "all of" group only when every condition does', async () => {
      const scope = await setupScope();
      const ruleId = await ruleChecking(scope, {
        match: 'ALL',
        conditions: [is('priority', 'HIGH'), is('sectionId', scope.sectionId)],
      });
      await publish(scope, ruleId).expect(200);

      expect(await holdsFor(scope, { priority: 'HIGH' })).toBe(true);
      expect(await holdsFor(scope, { priority: 'HIGH', sectionId: scope.otherSectionId })).toBe(
        false,
      );
    });

    it('judges a group inside a group as one of its parent’s conditions', async () => {
      // In the first section, and high or critical.
      const scope = await setupScope();
      const ruleId = await ruleChecking(scope, {
        match: 'ALL',
        conditions: [
          is('sectionId', scope.sectionId),
          { match: 'ANY', conditions: [is('priority', 'HIGH'), is('priority', 'CRITICAL')] },
        ],
      });
      await publish(scope, ruleId).expect(200);

      expect(await holdsFor(scope, { priority: 'CRITICAL' })).toBe(true);
      expect(await holdsFor(scope, { priority: 'LOW' })).toBe(false);
      expect(await holdsFor(scope, { priority: 'HIGH', sectionId: scope.otherSectionId })).toBe(
        false,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('publishing', () => {
    const problemsWith = async (condition: Record<string, unknown>) => {
      const scope = await setupScope();
      const ruleId = await ruleChecking(scope, condition);
      const response = await publish(scope, ruleId).expect(400);
      return (response.body.error.details.problems as string[]).join(' ');
    };

    it('refuses an empty group', async () => {
      expect(
        await problemsWith({
          match: 'ALL',
          conditions: [is('priority', 'HIGH'), { conditions: [] }],
        }),
      ).toMatch(/Add a condition to this group/);
    });

    it('refuses an unanswered condition inside a group', async () => {
      expect(
        await problemsWith({ match: 'ANY', conditions: [is('priority', 'HIGH'), {}] }),
      ).toMatch(/Choose what this step checks/);
    });

    it('refuses a comparison that does not fit its field, inside a group', async () => {
      expect(
        await problemsWith({
          match: 'ANY',
          conditions: [
            is('priority', 'HIGH'),
            { field: 'dueDate', operator: 'CONTAINS', value: 'x' },
          ],
        }),
      ).toMatch(/cannot be used with this kind of field/);
    });

    it('refuses an AI check inside a group', async () => {
      expect(
        await problemsWith({
          match: 'ANY',
          conditions: [is('priority', 'HIGH'), { field: 'ai.check', question: 'Is it urgent?' }],
        }),
      ).toMatch(/cannot be part of a group/);
    });

    it('names the condition at fault by its place in the group', async () => {
      const scope = await setupScope();
      const ruleId = await ruleChecking(scope, {
        match: 'ALL',
        conditions: [is('priority', 'HIGH'), { match: 'ANY', conditions: [{ field: 'priority' }] }],
      });

      const validation = await request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/validate`)
        .set(as(scope))
        .send({})
        .expect(200);

      expect(validation.body.data.issues).toContainEqual(
        expect.objectContaining({ path: 'conditions.1.conditions.0.operator' }),
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('where a grouped rule shows up', () => {
    it('lists a rule under a section its group checks', async () => {
      const scope = await setupScope();
      const ruleId = await ruleChecking(scope, {
        match: 'ANY',
        conditions: [is('sectionId', scope.otherSectionId), is('priority', 'HIGH')],
      });

      const listed = await request(server())
        .get(rulesUrl(scope))
        .query({ sectionId: scope.otherSectionId })
        .set(as(scope))
        .expect(200);

      expect(listed.body.data.map((rule: { id: string }) => rule.id)).toEqual([ruleId]);
    });

    it('carries a group into another project, matching its sections there by name', async () => {
      const scope = await setupScope();
      const ruleId = await ruleChecking(scope, {
        match: 'ANY',
        conditions: [is('sectionId', scope.otherSectionId), is('priority', 'HIGH')],
      });

      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/projects`))
        .set(as(scope))
        .send({ name: 'Renewals' })
        .expect(201);
      const otherProjectId = other.body.data.id as string;
      const sourceName = (
        await context.prisma.section.findUniqueOrThrow({ where: { id: scope.otherSectionId } })
      ).name;
      const sameName = (other.body.data.sections as { id: string; name: string }[]).find(
        (section) => section.name === sourceName,
      );

      const library = url(`/workspaces/${scope.workspaceId}/automation-templates`);
      const template = await request(server())
        .post(library)
        .set(as(scope))
        .send({ projectId: scope.projectId, ruleId })
        .expect(201);
      const applied = await request(server())
        .post(`${library}/${template.body.data.id}/apply`)
        .set(as(scope))
        .send({ projectId: otherProjectId })
        .expect(201);

      const condition = (
        applied.body.data.rule.nodes as {
          nodeType: string;
          configuration: Record<string, unknown>;
        }[]
      ).find((node) => node.nodeType === 'CONDITION');
      expect(condition?.configuration).toEqual({
        match: 'ANY',
        conditions: [is('sectionId', sameName?.id), is('priority', 'HIGH')],
      });
      expect(applied.body.data.unresolved).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  it('runs an "any of" group published through the structured definition', async () => {
    const scope = await setupScope();
    const ruleId = await ruleChecking(scope, is('priority', 'HIGH'));
    const definition = `${rulesUrl(scope)}/${ruleId}/definition`;

    await request(server())
      .put(definition)
      .set(as(scope))
      .send({
        name: 'Structured any',
        trigger: { type: 'TASK_CREATED', configuration: {} },
        branches: [
          {
            id: 'b0',
            type: 'PRIMARY',
            position: 0,
            conditionGroup: {
              id: 'g0',
              operator: 'ANY',
              conditions: [
                { id: 'c0', fieldKey: 'priority', operator: 'IS', value: 'HIGH', position: 0 },
                { id: 'c1', fieldKey: 'priority', operator: 'IS', value: 'CRITICAL', position: 1 },
              ],
            },
            actions: [
              { id: 'x0', actionType: 'ADD_COMMENT', configuration: { body: 'Hot' }, position: 0 },
            ],
          },
        ],
      })
      .expect(200);
    await request(server()).post(`${definition}/publish`).set(as(scope)).expect(200);

    expect(await holdsFor(scope, { priority: 'CRITICAL' })).toBe(true);
    expect(await holdsFor(scope, { priority: 'LOW' })).toBe(false);
  });
});
