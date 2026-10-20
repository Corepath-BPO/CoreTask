import { randomUUID } from 'node:crypto';

import { API_PREFIX, MAX_CHECKLISTS_PER_TASK, WorkspaceRole } from '@coretask/contracts';
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
 * A task's checklists and its team — each through the task routes a person
 * uses, and through the automation steps that write them: "Add a checklist"
 * and "Change team to…".
 */
describe('Task checklists and teams (e2e)', () => {
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

  interface Actor {
    token: string;
    userId: string;
  }

  interface Scope {
    owner: Actor;
    workspaceId: string;
    projectId: string;
    sectionId: string;
    taskId: string;
  }

  interface Checklist {
    id: string;
    name: string;
    position: number;
    items: {
      id: string;
      title: string;
      completed: boolean;
      completedAt: string | null;
      completedBy: { id: string; name: string } | null;
    }[];
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

  const workspace = async (owner: Actor, name: string) => {
    const created = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name })
      .expect(201);
    return created.body.data.id as string;
  };

  const setupScope = async (): Promise<Scope> => {
    const owner = await register('Owner');
    const workspaceId = await workspace(owner, 'Leasing Office');

    const project = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(as(owner))
      .send({ name: 'Move-ins' })
      .expect(201);
    const projectId = project.body.data.id as string;
    const sectionId = (project.body.data.sections as { id: string }[])[0]?.id ?? '';

    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(as(owner))
      .send({ title: 'Unit 4B', sectionId })
      .expect(201);

    return { owner, workspaceId, projectId, sectionId, taskId: task.body.data.id as string };
  };

  const checklistsUrl = (scope: Scope, taskId = scope.taskId) =>
    url(`/workspaces/${scope.workspaceId}/tasks/${taskId}/checklists`);

  const addChecklist = (scope: Scope, body: Record<string, unknown>, actor = scope.owner) =>
    request(server()).post(checklistsUrl(scope)).set(as(actor)).send(body);

  const createTeam = async (scope: Scope, name: string, workspaceId = scope.workspaceId) => {
    const response = await request(server())
      .post(url(`/workspaces/${workspaceId}/teams`))
      .set(as(scope.owner))
      .send({ name })
      .expect(201);
    return response.body.data.id as string;
  };

  const patchTask = (scope: Scope, body: Record<string, unknown>) =>
    request(server())
      .patch(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`))
      .set(as(scope.owner))
      .send(body);

  // -------------------------------------------------------------------------
  describe('checklists', () => {
    it('adds a checklist with its items in order, dropping blank lines', async () => {
      const scope = await setupScope();
      const response = await addChecklist(scope, {
        name: '  Move-in inspection ',
        items: ['Keys handed over', '   ', 'Meter readings taken'],
      }).expect(201);

      const lists = response.body.data as Checklist[];
      expect(lists).toHaveLength(1);
      expect(lists[0]?.name).toBe('Move-in inspection');
      expect(lists[0]?.items.map((item) => item.title)).toEqual([
        'Keys handed over',
        'Meter readings taken',
      ]);
      expect(lists[0]?.items.every((item) => !item.completed)).toBe(true);

      // And the list reads back the same.
      const listed = await request(server())
        .get(checklistsUrl(scope))
        .set(as(scope.owner))
        .expect(200);
      expect(listed.body.data).toEqual(lists);
    });

    it('ticks an item with who and when, and unticks it', async () => {
      const scope = await setupScope();
      const created = (
        await addChecklist(scope, { name: 'Inspection', items: ['Smoke alarms tested'] }).expect(
          201,
        )
      ).body.data as Checklist[];
      const list = created[0] as Checklist;
      const itemUrl = `${checklistsUrl(scope)}/${list.id}/items/${list.items[0]?.id}`;

      const ticked = await request(server())
        .patch(itemUrl)
        .set(as(scope.owner))
        .send({ completed: true })
        .expect(200);
      const item = (ticked.body.data as Checklist[])[0]?.items[0];
      expect(item?.completed).toBe(true);
      expect(item?.completedBy?.id).toBe(scope.owner.userId);
      expect(item?.completedAt).not.toBeNull();

      const unticked = await request(server())
        .patch(itemUrl)
        .set(as(scope.owner))
        .send({ completed: false })
        .expect(200);
      expect((unticked.body.data as Checklist[])[0]?.items[0]).toMatchObject({
        completed: false,
        completedAt: null,
        completedBy: null,
      });

      const stories = await context.prisma.activityLog.findMany({
        where: { entityId: scope.taskId, summary: { contains: 'Smoke alarms tested' } },
        orderBy: { createdAt: 'asc' },
        select: { summary: true },
      });
      expect(stories.map((story) => story.summary)).toEqual([
        'Ticked “Smoke alarms tested”',
        'Unticked “Smoke alarms tested”',
      ]);
    });

    it('renames, adds, removes and deletes', async () => {
      const scope = await setupScope();
      const [list] = (await addChecklist(scope, { name: 'Draft', items: ['One'] }).expect(201)).body
        .data as Checklist[];
      const listUrl = `${checklistsUrl(scope)}/${list?.id}`;

      await request(server())
        .patch(listUrl)
        .set(as(scope.owner))
        .send({ name: 'Final' })
        .expect(200);

      const added = await request(server())
        .post(`${listUrl}/items`)
        .set(as(scope.owner))
        .send({ title: 'Two' })
        .expect(201);
      const afterAdd = (added.body.data as Checklist[])[0] as Checklist;
      expect(afterAdd.name).toBe('Final');
      expect(afterAdd.items.map((item) => item.title)).toEqual(['One', 'Two']);

      const removed = await request(server())
        .delete(`${listUrl}/items/${afterAdd.items[0]?.id}`)
        .set(as(scope.owner))
        .expect(200);
      expect((removed.body.data as Checklist[])[0]?.items.map((item) => item.title)).toEqual([
        'Two',
      ]);

      const deleted = await request(server()).delete(listUrl).set(as(scope.owner)).expect(200);
      expect(deleted.body.data).toEqual([]);
      expect(await context.prisma.taskChecklistItem.count()).toBe(0);
    });

    it('refuses a nameless checklist, and an empty item', async () => {
      const scope = await setupScope();
      await addChecklist(scope, { name: '   ' }).expect(400);

      const [list] = (await addChecklist(scope, { name: 'Real' }).expect(201)).body
        .data as Checklist[];
      await request(server())
        .post(`${checklistsUrl(scope)}/${list?.id}/items`)
        .set(as(scope.owner))
        .send({ title: '  ' })
        .expect(400);
    });

    it(`stops at ${MAX_CHECKLISTS_PER_TASK} checklists on one task`, async () => {
      const scope = await setupScope();
      await context.prisma.taskChecklist.createMany({
        data: Array.from({ length: MAX_CHECKLISTS_PER_TASK }, (_, index) => ({
          workspaceId: scope.workspaceId,
          taskId: scope.taskId,
          name: `List ${index + 1}`,
          position: index,
        })),
      });

      const response = await addChecklist(scope, { name: 'One too many' }).expect(400);
      expect(response.body.error.message).toMatch(/up to 20 checklists/);
    });

    it('lets another member tick, and keeps the list from outsiders', async () => {
      const scope = await setupScope();
      const [list] = (
        await addChecklist(scope, { name: 'Inspection', items: ['Keys'] }).expect(201)
      ).body.data as Checklist[];

      const member = await register('Member');
      await context.prisma.workspaceMember.create({
        data: { workspaceId: scope.workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
      });
      const ticked = await request(server())
        .patch(`${checklistsUrl(scope)}/${list?.id}/items/${list?.items[0]?.id}`)
        .set(as(member))
        .send({ completed: true })
        .expect(200);
      expect((ticked.body.data as Checklist[])[0]?.items[0]?.completedBy?.name).toBe('Member');

      const outsider = await register('Outsider');
      await request(server()).get(checklistsUrl(scope)).set(as(outsider)).expect(403);
      await addChecklist(scope, { name: 'Mine' }, outsider).expect(403);
    });

    it('will not reach a checklist through another task', async () => {
      const scope = await setupScope();
      const [list] = (await addChecklist(scope, { name: 'Inspection' }).expect(201)).body
        .data as Checklist[];

      const other = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set(as(scope.owner))
        .send({ title: 'Unit 5C', sectionId: scope.sectionId })
        .expect(201);

      await request(server())
        .patch(`${checklistsUrl(scope, other.body.data.id as string)}/${list?.id}`)
        .set(as(scope.owner))
        .send({ name: 'Hijacked' })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('a task’s team', () => {
    it('sets the team, reads it back, tells the story, and clears it', async () => {
      const scope = await setupScope();
      const teamId = await createTeam(scope, 'Maintenance');

      const set = await patchTask(scope, { teamId }).expect(200);
      expect(set.body.data.teamId).toBe(teamId);
      expect(set.body.data.team).toMatchObject({ id: teamId, name: 'Maintenance' });

      const read = await request(server())
        .get(url(`/workspaces/${scope.workspaceId}/tasks/${scope.taskId}`))
        .set(as(scope.owner))
        .expect(200);
      expect(read.body.data.team?.name).toBe('Maintenance');

      const cleared = await patchTask(scope, { teamId: null }).expect(200);
      expect(cleared.body.data).toMatchObject({ teamId: null, team: null });

      const stories = await context.prisma.activityLog.findMany({
        where: { entityId: scope.taskId, metadata: { path: ['field'], equals: 'team' } },
        orderBy: { createdAt: 'asc' },
        select: { summary: true },
      });
      expect(stories.map((story) => story.summary)).toEqual([
        'Assigned to the team Maintenance',
        'Removed the team Maintenance',
      ]);
    });

    it('refuses a team from another workspace', async () => {
      const scope = await setupScope();
      const elsewhere = await workspace(scope.owner, 'Another Office');
      const foreignTeam = await createTeam(scope, 'Elsewhere', elsewhere);

      await patchTask(scope, { teamId: foreignTeam }).expect(400);
      await patchTask(scope, { teamId: randomUUID() }).expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('automation steps', () => {
    const rulesUrl = (scope: Scope) =>
      url(`/workspaces/${scope.workspaceId}/projects/${scope.projectId}/automations`);

    /** A published rule that runs one step on every new task. */
    const ruleWith = async (scope: Scope, subtype: string, configuration: object) => {
      const created = await request(server())
        .post(rulesUrl(scope))
        .set(as(scope.owner))
        .send({
          name: `Rule for ${subtype}`,
          triggerType: 'TASK_CREATED',
          nodes: [
            { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null, order: 0 },
            { id: 'a', nodeType: 'ACTION', subtype, configuration, parentId: 't', order: 1 },
          ],
        })
        .expect(201);
      return created.body.data.id as string;
    };

    const publish = (scope: Scope, ruleId: string) =>
      request(server())
        .post(`${rulesUrl(scope)}/${ruleId}/publish`)
        .set(as(scope.owner));

    const runOnNewTask = async (scope: Scope, title = 'Unit 7A') => {
      const task = await request(server())
        .post(url(`/workspaces/${scope.workspaceId}/tasks`))
        .set(as(scope.owner))
        .send({ title, sectionId: scope.sectionId })
        .expect(201);
      const taskId = task.body.data.id as string;

      const event: AutomationEvent = {
        eventId: randomUUID(),
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        trigger: 'TASK_CREATED',
        entityType: 'TASK',
        entityId: taskId,
        actorId: scope.owner.userId,
        correlationId: randomUUID(),
        depth: 0,
      };
      await runner.handle(event);
      return taskId;
    };

    const lastLog = () =>
      context.prisma.automationExecutionLog.findFirst({
        where: { nodeType: 'ACTION' },
        orderBy: { createdAt: 'desc' },
      });

    it('makes a team responsible for the task, and tells the story', async () => {
      const scope = await setupScope();
      const teamId = await createTeam(scope, 'Leasing');
      await publish(scope, await ruleWith(scope, 'ASSIGN_TEAM', { teamId })).expect(200);

      const taskId = await runOnNewTask(scope);
      const task = await context.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.teamId).toBe(teamId);

      const story = await context.prisma.activityLog.findFirst({
        where: { entityId: taskId, metadata: { path: ['field'], equals: 'team' } },
      });
      expect(story?.summary).toBe('Assigned to the team Leasing');
    });

    it('clears the team when the step says to', async () => {
      const scope = await setupScope();
      const teamId = await createTeam(scope, 'Leasing');
      // Every new task starts with the team, and the rule takes it off again.
      await publish(scope, await ruleWith(scope, 'ASSIGN_TEAM', { clear: true })).expect(200);
      const taskId = await runOnNewTask(scope);
      await context.prisma.task.update({ where: { id: taskId }, data: { teamId } });

      await runner.handle({
        eventId: randomUUID(),
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        trigger: 'TASK_CREATED',
        entityType: 'TASK',
        entityId: taskId,
        actorId: scope.owner.userId,
        correlationId: randomUUID(),
        depth: 0,
      });
      const task = await context.prisma.task.findUniqueOrThrow({ where: { id: taskId } });
      expect(task.teamId).toBeNull();
    });

    it('adds a checklist with its name filled in and its items unticked', async () => {
      const scope = await setupScope();
      await publish(
        scope,
        await ruleWith(scope, 'CREATE_CHECKLIST', {
          name: 'Inspection for {{task.name}}',
          items: ['Keys handed over', '', 'Meter readings taken'],
        }),
      ).expect(200);

      const taskId = await runOnNewTask(scope, 'Unit 9D');
      const response = await request(server())
        .get(checklistsUrl(scope, taskId))
        .set(as(scope.owner))
        .expect(200);
      const lists = response.body.data as Checklist[];
      expect(lists).toHaveLength(1);
      expect(lists[0]?.name).toBe('Inspection for Unit 9D');
      expect(lists[0]?.items.map((item) => [item.title, item.completed])).toEqual([
        ['Keys handed over', false],
        ['Meter readings taken', false],
      ]);
      expect((await lastLog())?.message).toBe(
        'Added the checklist “Inspection for Unit 9D” with 2 items',
      );
    });

    it('logs a failed step, rather than adding, once a task is full', async () => {
      const scope = await setupScope();
      await publish(
        scope,
        await ruleWith(scope, 'CREATE_CHECKLIST', { name: 'Inspection', items: ['Keys'] }),
      ).expect(200);

      // The scope’s task was made before the rule, so nothing has run on it yet.
      const taskId = scope.taskId;
      await context.prisma.taskChecklist.createMany({
        data: Array.from({ length: MAX_CHECKLISTS_PER_TASK }, (_, index) => ({
          workspaceId: scope.workspaceId,
          taskId,
          name: `List ${index + 1}`,
          position: index,
        })),
      });
      await runner.handle({
        eventId: randomUUID(),
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        trigger: 'TASK_CREATED',
        entityType: 'TASK',
        entityId: taskId,
        actorId: scope.owner.userId,
        correlationId: randomUUID(),
        depth: 0,
      });

      expect(await context.prisma.taskChecklist.count({ where: { taskId } })).toBe(
        MAX_CHECKLISTS_PER_TASK,
      );
      const log = await lastLog();
      expect(log?.succeeded).toBe(false);
      expect(log?.message).toMatch(/already has 20 checklists/);
    });

    describe('publishing', () => {
      const problemsWith = async (subtype: string, configuration: object) => {
        const scope = await setupScope();
        const response = await publish(scope, await ruleWith(scope, subtype, configuration)).expect(
          400,
        );
        return (response.body.error.details.problems as string[]).join(' ');
      };

      it('refuses a checklist step with no items', async () => {
        expect(
          await problemsWith('CREATE_CHECKLIST', { name: 'Inspection', items: ['', '  '] }),
        ).toMatch(/item/i);
      });

      it('refuses a checklist step with no name', async () => {
        expect(await problemsWith('CREATE_CHECKLIST', { items: ['Keys'] })).toMatch(/name/i);
      });

      it('refuses a team step that names no team', async () => {
        expect(await problemsWith('ASSIGN_TEAM', {})).toMatch(/team/i);
      });

      it('refuses a team from another workspace', async () => {
        const scope = await setupScope();
        const elsewhere = await workspace(scope.owner, 'Another Office');
        const foreignTeam = await createTeam(scope, 'Elsewhere', elsewhere);

        const response = await publish(
          scope,
          await ruleWith(scope, 'ASSIGN_TEAM', { teamId: foreignTeam }),
        ).expect(400);
        expect((response.body.error.details.problems as string[]).join(' ')).toMatch(/team/i);
      });
    });

    it('offers both steps, with the workspace’s teams, in the builder metadata', async () => {
      const scope = await setupScope();
      const teamId = await createTeam(scope, 'Leasing');

      const response = await request(server())
        .get(`${rulesUrl(scope)}/metadata`)
        .set(as(scope.owner))
        .expect(200);
      const actions = response.body.data.actions as { subtype: string; available: boolean }[];
      expect(actions.find((entry) => entry.subtype === 'ASSIGN_TEAM')?.available).toBe(true);
      expect(actions.find((entry) => entry.subtype === 'CREATE_CHECKLIST')?.available).toBe(true);
      expect(response.body.data.teams).toEqual([
        expect.objectContaining({ id: teamId, name: 'Leasing' }),
      ]);
    });
  });
});
