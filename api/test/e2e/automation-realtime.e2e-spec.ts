import { randomUUID } from 'node:crypto';

import { API_PREFIX, ServerEvent, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';
import { RedisService } from '../../src/redis/redis.service';
import { RealtimeRelayPublisher } from '../../src/websocket/realtime-relay.publisher';
import { RealtimeGateway } from '../../src/websocket/realtime.gateway';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/**
 * Who hears about a rule's change to a task.
 *
 * The runner lives in the worker and reaches browsers through the Redis relay.
 * It used to address only the project's room, so a task panel opened from My
 * Tasks, the inbox or search — in no project room — went on showing the fields
 * and checklists from before the rule ran. These run the real relay: the
 * runner publishes, the API's subscriber picks it up, and the gateway's emits
 * are watched.
 */
describe('Automation realtime (e2e)', () => {
  let context: TestContext;
  let runner: AutomationRunnerService;
  let gateway: RealtimeGateway;

  beforeAll(async () => {
    context = await createTestContext();
    runner = new AutomationRunnerService(
      context.prisma,
      new RealtimeRelayPublisher(context.app.get(RedisService)),
    );
    gateway = context.app.get(RealtimeGateway);
  });

  beforeEach(async () => {
    await context.prisma.truncateAllTables();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  const workspaceOf = async (owner: Actor) => {
    const created = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: 'Leasing Office' })
      .expect(201);
    return created.body.data.id as string;
  };

  const projectIn = async (workspaceId: string, owner: Actor, body: Record<string, unknown>) => {
    const created = await request(server())
      .post(url(`/workspaces/${workspaceId}/projects`))
      .set(as(owner))
      .send(body)
      .expect(201);
    return {
      projectId: created.body.data.id as string,
      sectionId: (created.body.data.sections as { id: string }[])[0]?.id ?? '',
    };
  };

  /** A live rule that runs `nodes` on every new task in the project. */
  const publishRule = async (
    workspaceId: string,
    projectId: string,
    owner: Actor,
    nodes: Record<string, unknown>[],
  ) => {
    const base = url(`/workspaces/${workspaceId}/projects/${projectId}/automations`);
    const created = await request(server())
      .post(base)
      .set(as(owner))
      .send({
        name: 'Move-in',
        triggerType: 'TASK_CREATED',
        nodes: [
          { id: 't', nodeType: 'TRIGGER', subtype: 'TASK_CREATED', parentId: null, order: 0 },
          ...nodes,
        ],
      })
      .expect(201);
    await request(server())
      .post(`${base}/${created.body.data.id as string}/publish`)
      .set(as(owner))
      .expect(200);
  };

  const checklistStep = (parentId: string, order: number) => ({
    id: `checklist-${order}`,
    nodeType: 'ACTION',
    subtype: 'CREATE_CHECKLIST',
    configuration: { name: 'Inspection', items: ['Keys handed over'] },
    parentId,
    order,
  });

  /** Makes a task, then runs the rules on it as the worker would. */
  const runOnNewTask = async (
    workspaceId: string,
    projectId: string,
    sectionId: string,
    owner: Actor,
  ) => {
    const task = await request(server())
      .post(url(`/workspaces/${workspaceId}/tasks`))
      .set(as(owner))
      .send({ title: 'Unit 4B', sectionId })
      .expect(201);
    const taskId = task.body.data.id as string;

    const event: AutomationEvent = {
      eventId: randomUUID(),
      workspaceId,
      projectId,
      trigger: 'TASK_CREATED',
      entityType: 'TASK',
      entityId: taskId,
      actorId: owner.userId,
      correlationId: randomUUID(),
      depth: 0,
    };
    await runner.handle(event);
    return taskId;
  };

  type Emit = [string | readonly string[], string, unknown];

  /** The relay is pub/sub, so the emit lands a moment after the run returns. */
  const waitForEmit = async (spy: jest.SpyInstance, matches: (call: Emit) => boolean) => {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const call = (spy.mock.calls as Emit[]).find(matches);
      if (call) return call;
      if (Date.now() > deadline) throw new Error('The rule’s change was never broadcast');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  };

  const ruleChangeTo = (taskId: string) => (call: Emit) =>
    call[1] === ServerEvent.WORK_ITEM_UPDATED &&
    (call[2] as { workItemId?: string }).workItemId === taskId;

  it('tells the whole workspace about a public project’s task, not only its room', async () => {
    const owner = await register('Owner');
    const workspaceId = await workspaceOf(owner);
    const { projectId, sectionId } = await projectIn(workspaceId, owner, { name: 'Move-ins' });
    const team = await request(server())
      .post(url(`/workspaces/${workspaceId}/teams`))
      .set(as(owner))
      .send({ name: 'Leasing' })
      .expect(201);
    await publishRule(workspaceId, projectId, owner, [
      {
        id: 'team',
        nodeType: 'ACTION',
        subtype: 'ASSIGN_TEAM',
        configuration: { teamId: team.body.data.id as string },
        parentId: 't',
        order: 1,
      },
      checklistStep('team', 2),
    ]);

    const toWorkspace = jest.spyOn(gateway, 'emitToWorkspace');
    const toProject = jest.spyOn(gateway, 'emitToProject');
    const taskId = await runOnNewTask(workspaceId, projectId, sectionId, owner);

    // The workspace room, where a panel opened from My Tasks is listening.
    const [room, , payload] = await waitForEmit(toWorkspace, ruleChangeTo(taskId));
    expect(room).toBe(workspaceId);
    expect(payload).toEqual(
      expect.objectContaining({
        workspaceId,
        projectId,
        workItemId: taskId,
        workItemType: 'TASK',
        source: 'automation',
      }),
    );
    // Said once. The project's tabs are in the workspace room too, and a second
    // copy to the project room would make them refetch everything twice.
    expect((toProject.mock.calls as Emit[]).filter(ruleChangeTo(taskId))).toHaveLength(0);
  });

  it('keeps a private project’s task to the people who may open the project', async () => {
    const owner = await register('Owner');
    const member = await register('Project member');
    const outsider = await register('Workspace member');
    const workspaceId = await workspaceOf(owner);
    for (const person of [member, outsider]) {
      await context.prisma.workspaceMember.create({
        data: { workspaceId, userId: person.userId, role: WorkspaceRole.MEMBER },
      });
    }
    const { projectId, sectionId } = await projectIn(workspaceId, owner, {
      name: 'Evictions',
      visibility: 'PRIVATE',
    });
    await context.prisma.projectMember.create({
      data: { projectId, userId: member.userId, workspaceId },
    });
    await publishRule(workspaceId, projectId, owner, [checklistStep('t', 1)]);

    const toUsers = jest.spyOn(gateway, 'emitToUsers');
    const toWorkspace = jest.spyOn(gateway, 'emitToWorkspace');
    const taskId = await runOnNewTask(workspaceId, projectId, sectionId, owner);

    const [audience] = await waitForEmit(toUsers, ruleChangeTo(taskId));
    expect(audience).toEqual(expect.arrayContaining([owner.userId, member.userId]));
    expect(audience).not.toContain(outsider.userId);
    expect((toWorkspace.mock.calls as Emit[]).filter(ruleChangeTo(taskId))).toHaveLength(0);
  });
});
