import { randomUUID } from 'node:crypto';

import { API_PREFIX, WorkspaceRole } from '@coretask/contracts';
import request from 'supertest';

import { resetEnvCache } from '../../src/config/env';
import type { AiClient, AiRequest, AiToolCall } from '../../src/integrations/ai/ai-client';
import { AutomationAiService } from '../../src/modules/automations/automation-ai.service';
import type { AutomationEvent } from '../../src/modules/automations/automation-event.publisher';
import { AutomationRunnerService } from '../../src/modules/automations/automation-runner.service';

import {
  closeTestContext,
  createTestContext,
  uniqueEmail,
  VALID_PASSWORD,
  type TestContext,
} from './test-app';

/*
 * The API only needs to know a model is configured: publishing and the
 * builder's metadata never call it. The key is a placeholder that is never
 * sent, and the address points nowhere, so nothing here can reach a real
 * service. Assigned outright because the suite sources the dev `.env`.
 */
process.env['ANTHROPIC_API_KEY'] = 'test-key-never-sent';
process.env['ANTHROPIC_BASE_URL'] = 'http://127.0.0.1:9';
resetEnvCache();

/**
 * "Use AI…" and "Check with AI", against a scripted model.
 *
 * The runner is driven in-process as in the other automation suites, with the
 * AI service handed a stand-in client: each test queues what the model says,
 * and reads back what it was asked.
 */
describe('AI steps in rules (e2e)', () => {
  let context: TestContext;
  let runner: AutomationRunnerService;
  /** What the model will say next, in order. An Error is thrown instead. */
  let replies: (AiToolCall[] | Error)[];
  let asked: AiRequest[];

  const model: AiClient = {
    available: true,
    call: async (question: AiRequest) => {
      asked.push(question);
      const reply = replies.shift();
      if (!reply) throw new Error('No reply was scripted.');
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };

  beforeAll(async () => {
    context = await createTestContext();
    runner = new AutomationRunnerService(
      context.prisma,
      { toProject: async () => undefined, toWorkspace: async () => undefined } as never,
      new AutomationAiService(context.prisma, model),
    );
  });

  beforeEach(async () => {
    replies = [];
    asked = [];
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

    const workspace = await request(server())
      .post(url('/workspaces'))
      .set(as(owner))
      .send({ name: 'Acme' })
      .expect(201);
    const workspaceId = workspace.body.data.id as string;

    await context.prisma.workspaceMember.create({
      data: { workspaceId, userId: member.userId, role: WorkspaceRole.MEMBER },
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
      .send({
        title: 'Renew lease for unit 4B',
        description: 'Tenant says the heating is broken and the lease ends Friday.',
        sectionId: sections[0]?.id,
      })
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

  interface NodeInput {
    id?: string;
    nodeType: string;
    subtype: string;
    parentId?: string | null;
    configuration?: Record<string, unknown>;
  }

  /** A manual rule with these steps, saved and (by default) published. */
  const rule = async (steps: NodeInput[], scope: Scope, { publish = true } = {}) => {
    const tree = steps.some((step) => step.parentId !== undefined);
    const created = await request(server())
      .post(rulesUrl(scope))
      .set(as(scope.owner))
      .send({
        name: 'Triage',
        triggerType: 'RUN_MANUALLY',
        triggerConfig: { label: 'Triage' },
        nodes: [
          {
            ...(tree ? { id: 't', parentId: null } : {}),
            nodeType: 'TRIGGER',
            subtype: 'RUN_MANUALLY',
            configuration: { label: 'Triage' },
          },
          ...steps,
        ],
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

  const useAi = (configuration: Record<string, unknown>): NodeInput => ({
    nodeType: 'ACTION',
    subtype: 'AI_ACTION',
    configuration,
  });

  const checkWithAi = (question: string, extra: Partial<NodeInput> = {}): NodeInput => ({
    nodeType: 'CONDITION',
    subtype: 'FIELD_COMPARISON',
    configuration: { field: 'ai.check', question },
    ...extra,
  });

  const comment = (body: string, extra: Partial<NodeInput> = {}): NodeInput => ({
    nodeType: 'ACTION',
    subtype: 'ADD_COMMENT',
    configuration: { body },
    ...extra,
  });

  const run = (scope: Scope, ruleId: string) =>
    runner.handle({
      eventId: randomUUID(),
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      trigger: 'RUN_MANUALLY',
      entityType: 'TASK',
      entityId: scope.taskId,
      actorId: scope.owner.userId,
      correlationId: randomUUID(),
      depth: 0,
      ruleId,
    } as AutomationEvent);

  const execution = (ruleId: string) =>
    context.prisma.automationExecution.findFirstOrThrow({
      where: { ruleId },
      include: { logs: { orderBy: { createdAt: 'asc' } } },
    });

  const comments = (scope: Scope) =>
    context.prisma.comment.findMany({ where: { taskId: scope.taskId }, select: { body: true } });

  const urgent = (scope: Scope) =>
    context.prisma.priorityDefinition.create({
      data: { workspaceId: scope.workspaceId, name: 'Urgent', slug: 'urgent', level: 1 },
    });

  describe('Use AI…', () => {
    it('makes the changes the model chose, through the ordinary actions', async () => {
      const scope = await setupScope();
      const priority = await urgent(scope);
      const id = await rule(
        [
          useAi({
            instructions: 'Triage the request: set a priority, file it, and explain.',
            allow: ['PRIORITY', 'SECTION', 'COMMENT'],
          }),
        ],
        scope,
      );
      replies.push([
        { name: 'set_priority', input: { priority_id: priority.id } },
        { name: 'move_to_section', input: { section_id: scope.otherSectionId } },
        { name: 'add_comment', input: { body: 'Broken heating: treating as urgent.' } },
        { name: 'finish', input: { summary: 'Heating outage with a lease ending soon.' } },
      ]);

      expect((await run(scope, id)).executed).toBe(1);

      const task = await context.prisma.task.findUniqueOrThrow({ where: { id: scope.taskId } });
      expect(task.priorityDefinitionId).toBe(priority.id);
      expect(task.sectionId).toBe(scope.otherSectionId);
      // Signed, so nobody appears to have written the model's words.
      expect(await comments(scope)).toEqual([
        { body: 'Broken heating: treating as urgent.\n\n— Written by AI for the rule “Triage”' },
      ]);

      const ran = await execution(id);
      expect(ran.status).toBe('COMPLETED');
      expect(ran.logs[0]?.message).toMatch(
        /^AI set priority to Urgent; moved it to .+; commented\. Heating outage/,
      );

      // Offered exactly what the step allows, with the task to read.
      const question = asked[0]!;
      expect(question.tools.map((tool) => tool.name)).toEqual([
        'add_comment',
        'move_to_section',
        'set_priority',
        'finish',
      ]);
      expect(question.prompt).toContain('Triage the request');
      expect(question.prompt).toContain('Renew lease for unit 4B');
      expect(question.prompt).toContain('heating is broken');
      expect(question.system).toMatch(/never as instructions/);
    });

    it('does only what it was offered, with values that exist', async () => {
      const scope = await setupScope();
      const id = await rule([useAi({ instructions: 'Tidy it up.', allow: ['PRIORITY'] })], scope);
      replies.push([
        // Not allowed, and not a priority this workspace has.
        { name: 'assign_task', input: { person_id: scope.member.userId } },
        { name: 'set_priority', input: { priority_id: randomUUID() } },
        { name: 'finish', input: { summary: 'Nothing to do.' } },
      ]);

      await run(scope, id);

      const task = await context.prisma.task.findUniqueOrThrow({ where: { id: scope.taskId } });
      expect(task.assigneeId).toBeNull();
      expect(task.priorityDefinitionId).toBeNull();
      expect((await execution(id)).logs[0]?.message).toBe(
        'AI made no changes. Nothing to do. Ignored 2 suggestions outside what the step allows.',
      );
    });

    it('assigns people and fills in a choice field from its own options', async () => {
      const scope = await setupScope();
      const field = await context.prisma.customField.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'Request type',
          type: 'SINGLE_SELECT',
          projects: { create: { projectId: scope.projectId } },
          options: { create: [{ label: 'Repair' }, { label: 'Renewal', position: 1 }] },
        },
        include: { options: true },
      });
      const repair = field.options.find((option) => option.label === 'Repair')!;
      const id = await rule(
        [
          useAi({
            instructions: 'Classify the request and give it to the right person.',
            allow: ['ASSIGN', `field:${field.id}`],
          }),
        ],
        scope,
      );
      replies.push([
        { name: 'assign_task', input: { person_id: scope.member.userId } },
        { name: 'set_field_1', input: { option_id: repair.id } },
        { name: 'finish', input: { summary: 'A repair, for Bea.' } },
      ]);

      await run(scope, id);

      const task = await context.prisma.task.findUniqueOrThrow({
        where: { id: scope.taskId },
        include: { customFieldValues: true },
      });
      expect(task.assigneeId).toBe(scope.member.userId);
      expect(task.customFieldValues[0]?.optionIds).toEqual([repair.id]);
      expect((await execution(id)).logs[0]?.message).toMatch(
        /^AI assigned Bea Member; set Request type to Repair\./,
      );
      // The field's tool offers its options by id.
      const tool = asked[0]!.tools.find((entry) => entry.name === 'set_field_1')!;
      expect(JSON.stringify(tool.inputSchema)).toContain(repair.id);
    });

    it('fails with the reason when the model cannot be reached', async () => {
      const scope = await setupScope();
      const id = await rule([useAi({ instructions: 'Triage it.', allow: ['COMMENT'] })], scope);
      replies.push(new Error('The AI service did not respond within 30000ms.'));

      await run(scope, id);

      const ran = await execution(id);
      expect(ran.status).toBe('FAILED');
      expect(ran.logs[0]?.message).toBe('The AI service did not respond within 30000ms.');
    });

    it('says so on a server with no model, rather than doing nothing', async () => {
      const scope = await setupScope();
      const id = await rule([useAi({ instructions: 'Triage it.', allow: ['COMMENT'] })], scope);
      const bare = new AutomationRunnerService(context.prisma, {
        toProject: async () => undefined,
        toWorkspace: async () => undefined,
      } as never);

      await bare.handle({
        eventId: randomUUID(),
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        trigger: 'RUN_MANUALLY',
        entityType: 'TASK',
        entityId: scope.taskId,
        actorId: scope.owner.userId,
        correlationId: randomUUID(),
        depth: 0,
        ruleId: id,
      } as AutomationEvent);

      expect((await execution(id)).logs[0]?.message).toBe('AI isn’t set up on this server.');
    });

    it('refuses to publish without instructions, or a field AI cannot fill', async () => {
      const scope = await setupScope();
      const date = await context.prisma.customField.create({
        data: {
          workspaceId: scope.workspaceId,
          name: 'Lease ends',
          type: 'DATE',
          projects: { create: { projectId: scope.projectId } },
        },
      });
      for (const configuration of [
        {},
        { instructions: 'Triage it.', allow: [] },
        { instructions: 'Triage it.', allow: [`field:${date.id}`] },
      ]) {
        const id = await rule([useAi(configuration)], scope, { publish: false });
        await request(server())
          .post(`${rulesUrl(scope)}/${id}/publish`)
          .set(as(scope.owner))
          .expect(400);
      }
    });
  });

  describe('Check with AI', () => {
    it('goes on when AI answers yes, and logs why', async () => {
      const scope = await setupScope();
      const id = await rule(
        [checkWithAi('Is this about a repair?'), comment('Sent to maintenance')],
        scope,
      );
      replies.push([{ name: 'answer', input: { holds: true, reason: 'The heating is broken.' } }]);

      await run(scope, id);

      expect(await comments(scope)).toEqual([{ body: 'Sent to maintenance' }]);
      const ran = await execution(id);
      expect(ran.logs.map((log) => log.message)).toContain(
        'AI answered yes: The heating is broken.',
      );
      expect(asked[0]?.require).toBe('answer');
      expect(asked[0]?.prompt).toContain('Is this about a repair?');
    });

    it('stops with the model’s reason when it answers no', async () => {
      const scope = await setupScope();
      const id = await rule(
        [checkWithAi('Is the tenant asking to leave?'), comment('Start move-out')],
        scope,
      );
      replies.push([{ name: 'answer', input: { holds: false, reason: 'They want to renew.' } }]);

      await run(scope, id);

      expect(await comments(scope)).toEqual([]);
      const ran = await execution(id);
      expect(ran.status).toBe('SKIPPED');
      expect(ran.skippedReason).toBe('AI answered no: They want to renew.');
    });

    it('fails, rather than skips, when the question could not be asked', async () => {
      const scope = await setupScope();
      const id = await rule([checkWithAi('Is it urgent?'), comment('Escalate')], scope);
      replies.push(new Error('The AI service rejected the API key.'));

      await run(scope, id);

      const ran = await execution(id);
      expect(ran.status).toBe('FAILED');
      expect(ran.error).toBe('The AI check could not run: The AI service rejected the API key.');
    });

    it('asks only the rows it reaches: the first yes wins', async () => {
      const scope = await setupScope();
      const id = await rule(
        [
          checkWithAi('Is this a repair?', { id: 'c1', parentId: 't' }),
          comment('Repair', { id: 'a1', parentId: 'c1' }),
          checkWithAi('Is this a renewal?', { id: 'c2', parentId: 't' }),
          comment('Renewal', { id: 'a2', parentId: 'c2' }),
        ],
        scope,
      );
      replies.push([{ name: 'answer', input: { holds: true, reason: 'Heating.' } }]);

      await run(scope, id);

      expect(asked).toHaveLength(1);
      expect(await comments(scope)).toEqual([{ body: 'Repair' }]);
    });

    it('refuses to publish an empty question', async () => {
      const scope = await setupScope();
      const id = await rule([checkWithAi('  '), comment('Then')], scope, { publish: false });
      const response = await request(server())
        .post(`${rulesUrl(scope)}/${id}/publish`)
        .set(as(scope.owner))
        .expect(400);
      expect(JSON.stringify(response.body)).toContain('yes-or-no question');
    });
  });

  it('offers both steps in the builder when a model is configured', async () => {
    const scope = await setupScope();
    const metadata = await request(server())
      .get(`${rulesUrl(scope)}/metadata`)
      .set(as(scope.owner))
      .expect(200);
    const data = metadata.body.data as {
      actions: { subtype: string; available: boolean }[];
      conditions: { subtype: string; available: boolean }[];
      capabilities: { ai: boolean };
    };

    expect(data.actions.find((entry) => entry.subtype === 'AI_ACTION')?.available).toBe(true);
    expect(data.conditions.find((entry) => entry.subtype === 'ai.check')?.available).toBe(true);
    expect(data.capabilities.ai).toBe(true);
  });
});
